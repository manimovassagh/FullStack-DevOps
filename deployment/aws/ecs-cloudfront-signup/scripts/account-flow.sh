#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# A brand-new person goes through every account step, through CloudFront like a browser would: sign up, the
# emailed code, sign in, profile, password change, forgot/reset, sign out everywhere. The codes come from the
# emulator's mail inbox (Floci delivers Cognito's emails to its SES: GET <floci>/_aws/ses).
# Usage: account-flow.sh <app_url> <floci_endpoint>
set -euo pipefail
BASE=${1:?app url}; FLOCI=${2:?floci endpoint}
API="$BASE/api"
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT

EMAIL="smoke-$(date +%s)-$RANDOM@plant.example"
PW1='First-Pass-2026!'; PW2='Second-Pass-2026!'; PW3='Third-Pass-2026!'
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# JSON body from key=value pairs (no hand-escaped quotes: macOS's bash 3.2 mangles those inside "$(…)").
b() { jq -nc '$ARGS.positional | map(split("=") | {(.[0]): (.[1:] | join("="))}) | add' --args "$@"; }
post() { curl -s -o /dev/null -w '%{http_code}' -X POST "$API$1" -H 'content-type: application/json' -d "$2" "${@:3}"; }
login() { curl -s -c "$JAR" -X POST "$API/auth/login" -H 'content-type: application/json' -d "$(b username="$EMAIL" password="$1")"; }
token() { login "$1" | jq -r '.access_token // empty'; }
# Newest email to this person (sorted by time: Floci's list order is not fixed). Waits a moment for delivery.
mailcode() {
  for _ in 1 2 3 4 5; do
    c=$(curl -s "$FLOCI/_aws/ses" | jq -r --arg to "$EMAIL" \
      '[.messages[] | select(.Destination.ToAddresses | index($to))] | sort_by(.Timestamp) | last | .Body.text_part // empty' | grep -oE '[0-9]{6}' | head -1 || true)
    [ -n "$c" ] && [ "$c" != "${1:-}" ] && { echo "$c"; return; }
    sleep 1
  done
}

echo "as $EMAIL"
# --- sign up
[ "$(post /auth/signup "$(b email="$EMAIL" password="short" name="Smoke")")" = 400 ] && pass "weak password refused" || fail "weak password accepted"
[ "$(post /auth/signup "$(b email="not-an-email" password="$PW1" name="Smoke")")" = 400 ] && pass "bad email refused" || fail "bad email accepted"
[ "$(post /auth/signup "$(b email="$EMAIL" password="$PW1" name="Smoke Tester")")" = 201 ] && pass "sign up → 201, code emailed" || fail "sign up"
[ "$(post /auth/signup "$(b email="$EMAIL" password="$PW1" name="Again")")" = 409 ] && pass "same email again → 409" || fail "duplicate sign-up"
r=$(login "$PW1"); [ "$(echo "$r" | jq -r .code)" = not_confirmed ] && pass "sign in before confirming → 'confirm your email'" || fail "unconfirmed sign-in: $r"

# --- confirm
c1=$(mailcode); [ -n "$c1" ] && pass "code arrived in the inbox" || fail "no code email for $EMAIL"
[ "$(post /auth/confirm "$(b email="$EMAIL" code="000000")")" = 400 ] && pass "wrong code → 400" || fail "wrong code accepted"
[ "$(post /auth/confirm "$(b email="$EMAIL" code="$c1")")" = 204 ] && pass "right code → confirmed" || fail "confirm"

# --- signed in
T=$(token "$PW1"); [ -n "$T" ] && pass "sign in → access token, refresh cookie" || fail "sign in after confirm"
grep -q plant_refresh "$JAR" && pass "… refresh token only in an HttpOnly cookie" || fail "no refresh cookie"
[ "$(curl -s "$API/account" -H "Authorization: Bearer $T" | jq -r .name)" = "Smoke Tester" ] && pass "profile shows the name from sign-up" || fail "profile"
[ "$(curl -s -X PATCH "$API/account" -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"name":"Renamed"}' | jq -r .name)" = Renamed ] \
  && pass "rename" || fail "rename"
[ "$(curl -s "$API/auth/me" -H "Authorization: Bearer $T" | jq -r .name)" = Renamed ] && pass "the header's /auth/me sees the new name" || fail "/auth/me name"
[ "$(code "$API/plants" -H "Authorization: Bearer $T")" = 200 ] && pass "the app's API works for the new person" || fail "plants with token"
[ "$(code "$API/plants")" = 401 ] && pass "… and not without a token" || fail "anonymous plants"

# --- change password
[ "$(post /account/password "$(b current="wrong-Pass-2026!" new="$PW2")" -H "Authorization: Bearer $T")" = 400 ] && pass "wrong current password → 400" || fail "wrong current password"
[ "$(post /account/password "$(b current="$PW1" new="$PW2")" -H "Authorization: Bearer $T")" = 204 ] && pass "password changed" || fail "change password"
[ -z "$(token "$PW1")" ] && pass "old password no longer signs in" || fail "old password still works"
T=$(token "$PW2"); [ -n "$T" ] && pass "new password signs in" || fail "new password"

# --- forgot / reset
[ "$(post /auth/forgot '{"email":"nobody-here@plant.example"}')" = 204 ] && pass "forgot for an unknown email → 204 (does not reveal accounts)" || fail "forgot unknown"
[ "$(post /auth/forgot "$(b email="$EMAIL")")" = 204 ] && pass "forgot → reset code emailed" || fail "forgot"
c2=$(mailcode "$c1"); [ -n "$c2" ] && pass "reset code arrived" || fail "no reset code"
[ "$(post /auth/reset "$(b email="$EMAIL" code="$c2" password="$PW3")")" = 204 ] && pass "password reset" || fail "reset"
T=$(token "$PW3"); [ -n "$T" ] && pass "signs in with the reset password" || fail "sign in after reset"

# --- sign out everywhere
[ "$(post /account/signout-everywhere '' -H "Authorization: Bearer $T")" = 204 ] && pass "sign out everywhere" || fail "global sign out"
[ "$(code "$API/account" -H "Authorization: Bearer $T")" = 401 ] && pass "… the token is revoked at once" || fail "token still valid after global sign out"
[ "$(code -X POST -b "$JAR" "$API/auth/refresh")" = 401 ] && pass "… and the refresh token too" || fail "refresh still works"

echo "ACCOUNT FLOW PASSED"
