#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# Who answers a request: API Gateway's JWT authorizer or the function. A 401 from the gateway has the body
# {"message":"Unauthorized"}; the function's own 401 is {"error": "..."}. So the body tells us whether the
# Lambda ran at all. auth-smoke.sh then checks the per-user rules the function enforces.
# Usage: gateway-rules.sh <base_url>
set -euo pipefail
BASE=${1:?base url}
API="$BASE/api"
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
# req <out-file> <curl args…>: prints the status code, keeps the body in the file
req() { local out=$1; shift; curl -s -o "$out" -w '%{http_code}' "$@"; }
gateway_401() { [ "$1" = 401 ] && grep -q '"message" *: *"Unauthorized"' "$2"; }
app_401() { [ "$1" = 401 ] && grep -q '"error"' "$2"; }

ALICE=$("$HERE/token.sh" "$BASE" alice@plant.example) || fail "alice cannot sign in"
pass "alice signs in through the open login route"

# --- open routes reach the function
c=$(req "$TMP/b" "$API/health"); [ "$c" = 200 ] && pass "GET /api/health is open → 200" || fail "health returned $c"
c=$(req "$TMP/b" -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"username":"alice@plant.example","password":"wrong"}')
app_401 "$c" "$TMP/b" && pass "wrong password → 401 from the function (the login route is open)" || fail "login route: $c $(cat "$TMP/b")"

# --- protected routes: the gateway answers, the function never runs
c=$(req "$TMP/b" "$API/plants")
gateway_401 "$c" "$TMP/b" && pass "no token → 401 from the gateway" || fail "no token: $c $(cat "$TMP/b")"
c=$(req "$TMP/b" -H 'Authorization: Bearer not.a.jwt' "$API/plants")
gateway_401 "$c" "$TMP/b" && pass "garbage token → 401 from the gateway" || fail "garbage token: $c $(cat "$TMP/b")"
c=$(req "$TMP/b" -H "Authorization: Bearer ${ALICE%.*}.AAAA" "$API/plants")
gateway_401 "$c" "$TMP/b" && pass "forged signature → 401 from the gateway" || fail "forged signature: $c $(cat "$TMP/b")"
c=$(req "$TMP/b" -X POST "$API/plants" -H 'content-type: application/json' -d '{"name":"x","water_every_days":1}')
gateway_401 "$c" "$TMP/b" && pass "anonymous create → 401 from the gateway" || fail "anonymous create: $c $(cat "$TMP/b")"
c=$(req "$TMP/b" "$API/auth/me")
gateway_401 "$c" "$TMP/b" && pass "GET /api/auth/me without a token → 401 from the gateway (only POST /api/auth/* is open)" || fail "auth/me: $c $(cat "$TMP/b")"

# --- a valid token passes the gateway and the function
c=$(req "$TMP/b" -H "Authorization: Bearer $ALICE" "$API/plants"); [ "$c" = 200 ] && pass "valid token → 200" || fail "valid token: $c $(cat "$TMP/b")"
c=$(req "$TMP/b" -H "Authorization: Bearer $ALICE" "$API/auth/me")
[ "$c" = 200 ] && grep -q alice@plant.example "$TMP/b" && pass "/api/auth/me names alice" || fail "auth/me with token: $c $(cat "$TMP/b")"

echo "GATEWAY RULES PASSED"
