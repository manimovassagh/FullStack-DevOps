#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# Authentication and authorization checks through the ALB, on top of the shared API smoke test:
# who gets in, who sees what, and what a forged or revoked token can do.
# Usage: auth-smoke.sh <base_url>
set -euo pipefail
BASE=${1:?base url}
API="$BASE/api"
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

ALICE=$("$HERE/token.sh" "$BASE" alice@plant.example) || fail "alice cannot sign in"
BOB=$("$HERE/token.sh" "$BASE" bob@plant.example) || fail "bob cannot sign in"
ROOT=$("$HERE/token.sh" "$BASE" root@plant.example) || fail "root cannot sign in"
pass "three users sign in"
as() { local t=$1; shift; curl -s -H "Authorization: Bearer $t" "$@"; }

# --- authentication: who gets in
[ "$(code "$API/health")" = 200 ] && pass "health stays open (the load balancer polls it)" || fail "health"
[ "$(code "$API/plants")" = 401 ] && pass "no token → 401" || fail "anonymous list was not rejected"
[ "$(code -X POST "$API/plants" -H 'content-type: application/json' -d '{"name":"x","water_every_days":1}')" = 401 ] && pass "anonymous create → 401" || fail "anonymous create"
[ "$(code -H 'Authorization: Bearer not.a.jwt' "$API/plants")" = 401 ] && pass "garbage token → 401" || fail "garbage token"
# Same header and payload, signature replaced: the keys, not the claims, decide.
FORGED="${ALICE%.*}.AAAA"
[ "$(code -H "Authorization: Bearer $FORGED" "$API/plants")" = 401 ] && pass "forged signature → 401" || fail "forged signature accepted"
[ "$(code -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"username":"alice@plant.example","password":"wrong"}')" = 401 ] && pass "wrong password → 401" || fail "wrong password"
[ "$(code -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"username":"nobody@plant.example","password":"wrong"}')" = 401 ] && pass "unknown user looks the same → 401" || fail "unknown user"
[ "$(as "$ALICE" "$API/auth/me" | json '["username"]')" = alice@plant.example ] && pass "/api/auth/me names the caller" || fail "/api/auth/me"

# --- authorization: who sees what
P=$(as "$ALICE" -X POST "$API/plants" -H 'content-type: application/json' -d '{"name":"Alice private fern","water_every_days":7}')
ID=$(echo "$P" | json '["id"]'); pass "alice creates a plant"
{ printf '\x89PNG\r\n\x1a\n'; head -c 2048 /dev/urandom; } > "$TMP/a.png"
MID=$(as "$ALICE" -X POST "$API/plants/$ID/media" -F "file=@$TMP/a.png;type=image/png" | json '["id"]'); pass "alice uploads a photo"

[ "$(as "$BOB" "$API/plants" | json '.__len__()')" = 0 ] && pass "bob's list is empty" || fail "bob sees other users' plants"
for call in "GET plants/$ID" "PATCH plants/$ID" "POST plants/$ID/water" "DELETE plants/$ID" "GET media/$MID" "DELETE media/$MID"; do
  read -r method path <<<"$call"
  [ "$(code -X "$method" -H "Authorization: Bearer $BOB" -H 'content-type: application/json' -d '{}' "$API/$path")" = 404 ] \
    && pass "bob: $method /$path → 404 (not 403: nobody learns it exists)" || fail "bob: $method /$path was not refused"
done
[ "$(as "$BOB" -X POST "$API/plants/$ID/media" -F "file=@$TMP/a.png;type=image/png" -o /dev/null -w '%{http_code}')" = 404 ] && pass "bob cannot upload to alice's plant" || fail "bob uploaded to alice's plant"
[ "$(as "$ALICE" "$API/plants/$ID" | json '["name"]')" = "Alice private fern" ] && pass "alice's plant is untouched" || fail "alice's plant changed"
[ "$(as "$ROOT" "$API/plants" | json '.__len__()')" -ge 1 ] && pass "admin sees every user's plants" || fail "admin cannot see alice's plant"
[ "$(as "$ROOT" -o /dev/null -w '%{http_code}' "$API/media/$MID")" = 200 ] && pass "admin can open alice's photo" || fail "admin cannot open the photo"

# --- the refresh cookie
JAR="$TMP/jar"
curl -s -c "$JAR" -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"username":"alice@plant.example","password":"Plant-Parent-2026!"}' -o "$TMP/login.json"
grep -q 'HttpOnly' "$JAR" && pass "refresh token is an HttpOnly cookie" || fail "refresh cookie is not HttpOnly"
grep -q refresh_token "$TMP/login.json" && fail "refresh token leaked into the response body" || pass "refresh token is not in the response body"
NEW=$(curl -s -b "$JAR" -X POST "$API/auth/refresh" | json '["access_token"]') && [ -n "$NEW" ] && pass "refresh issues a new access token" || fail "refresh"
[ "$(code -X POST "$API/auth/refresh")" = 401 ] && pass "refresh without the cookie → 401" || fail "refresh without cookie"
# Logout revokes the refresh token in Cognito: replaying the old cookie value must fail, not just be forgotten by the browser.
OLD=$(awk '/plant_refresh/ {print $NF}' "$JAR")
curl -s -b "$JAR" -c "$JAR" -X POST "$API/auth/logout" -o /dev/null
[ "$(code -H "Cookie: plant_refresh=$OLD" -X POST "$API/auth/refresh")" = 401 ] && pass "a refresh token replayed after logout is revoked" || fail "refresh token still works after logout"

as "$ALICE" -X DELETE "$API/plants/$ID" -o /dev/null
echo "AUTH SMOKE PASSED"
