#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# Optional sign-in, as a visitor sees it: everyone can browse, a change needs a session, and the sign-in link
# goes to the Cognito hosted login. Enforced in front of the unchanged app: by the ALB on real AWS, by
# oauth2-proxy on Floci (proxy.tf). Usage: auth-rules.sh <base_url> <cookie_jar>
set -euo pipefail
BASE=${1:?base url}; JAR=${2:?cookie jar from hosted-login.mjs}
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
new_plant='{"name":"auth-rules","water_every_days":3}'

# --- no session: reading is open
[ "$(code "$BASE/")" = 200 ] && pass "page without a session → 200 (the app opens)" || fail "page refused without a session"
curl -s "$BASE/" | grep -q 'src="/signin.js"' && pass "… with the Sign in button (signin.js)" || fail "page has no signin.js"
[ "$(code "$BASE/api/plants")" = 200 ] && pass "GET /api/plants without a session → 200" || fail "anonymous read refused"

# --- no session: changes are not
[ "$(code -X POST "$BASE/api/plants" -H 'content-type: application/json' -d "$new_plant")" = 401 ] \
  && pass "anonymous create → 401" || fail "anonymous create was not denied"
[ "$(code -X DELETE "$BASE/api/plants/00000000-0000-0000-0000-000000000000")" = 401 ] \
  && pass "anonymous delete → 401" || fail "anonymous delete was not denied"
[ "$(code -X POST -H 'Cookie: plant_session=forged; AWSELBAuthSessionCookie-0=forged' "$BASE/api/plants" \
  -H 'content-type: application/json' -d "$new_plant")" = 401 ] && pass "forged session cookie → 401" || fail "forged cookie accepted"

# --- the sign-in link
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/oauth2/start?rd=/")
[[ $loc == *"/oauth2/authorize"*"client_id="* || $loc == *"client_id="*"/oauth2/authorize"* ]] \
  && pass "sign-in link → the Cognito hosted login" || fail "sign-in link goes to '$loc'"

# --- signed in
id=$(curl -sf -b "$JAR" -X POST "$BASE/api/plants" -H 'content-type: application/json' -d "$new_plant" | jq -r .id) \
  && [ -n "$id" ] && pass "signed in: create → saved" || fail "signed-in create refused"
[ "$(code -b "$JAR" -X DELETE "$BASE/api/plants/$id")" = 204 ] && pass "signed in: delete → 204" || fail "signed-in delete refused"

# --- sign out (last: it ends the session in the jar). Both sessions go: the app's cookie and the hosted
# login's, or the next "Sign in" would come straight back without the form.
end=$(curl -s -L -b "$JAR" -c "$JAR" -o /dev/null -w '%{url_effective}' "$BASE/signout")
[ "$end" = "$BASE/" ] && pass "sign out → back on the app" || fail "sign out ended at $end"
[ "$(code -b "$JAR" -X POST "$BASE/api/plants" -H 'content-type: application/json' -d "$new_plant")" = 401 ] \
  && pass "after sign out: create → 401" || fail "session still works after sign out"
again=$(curl -s -L -b "$JAR" -o /dev/null -w '%{url_effective}' "$BASE/oauth2/start?rd=/")
[[ $again == *"/login"* ]] && pass "after sign out: Sign in shows the login form again" || fail "signed in again without the form ($again)"

echo "AUTH RULES PASSED"
