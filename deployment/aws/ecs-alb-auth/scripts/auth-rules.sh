#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# What the load balancer lets through, before and after sign-in. The app behind it is the unchanged
# backend/ and frontend/: every rule checked here is enforced by the ALB alone.
# Usage: auth-rules.sh <base_url> <cookie_jar>
set -euo pipefail
BASE=${1:?base url}; JAR=${2:?cookie jar from hosted-login.mjs}
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# --- no session
[ "$(code "$BASE/")" = 302 ] && pass "page without a session → 302" || fail "page was served without a session"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/")
[[ $loc == *"/oauth2/authorize"*"client_id="* || $loc == *"client_id="*"/oauth2/authorize"* ]] \
  && pass "… to the Cognito hosted login" || fail "redirect goes to $loc"
[ "$(code "$BASE/api/plants")" = 401 ] && pass "API without a session → 401 (deny, not a redirect)" || fail "anonymous API call was not denied"
[ "$(code -X POST "$BASE/api/plants" -H 'content-type: application/json' -d '{"name":"x","water_every_days":1}')" = 401 ] \
  && pass "anonymous create → 401" || fail "anonymous create"

# --- forged session: the ALB encrypts its cookie, so a made-up value is no session at all
[ "$(code -H 'Cookie: AWSELBAuthSessionCookie-0=forged' "$BASE/api/plants")" = 401 ] && pass "forged session cookie → 401" || fail "forged cookie accepted"
[ "$(code -H 'Cookie: AWSELBAuthSessionCookie-0=forged' "$BASE/")" = 302 ] && pass "forged cookie on a page → back to login" || fail "forged cookie served a page"

# --- signed in
[ "$(code -b "$JAR" "$BASE/api/plants")" = 200 ] && pass "signed in: API → 200" || fail "signed-in API call refused"
curl -s -b "$JAR" "$BASE/" | grep -q '<div id="root">' && pass "signed in: the app page" || fail "signed-in page is not the app"

echo "AUTH RULES PASSED"
