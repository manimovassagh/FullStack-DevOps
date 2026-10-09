#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# End-to-end check through the ALB: the same journey a user takes in the browser.
# Usage: smoke.sh <base_url> <media_bucket>
set -euo pipefail
BASE=${1:?base url}; BUCKET=${2:?media bucket}
API="$BASE/api"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
AWS=(aws --endpoint-url "${FLOCI_ENDPOINT:-http://localhost:4566}" --region us-east-1)
# List the object names under a prefix in the media bucket. Stages whose storage is not S3 set
# SMOKE_LIST_OBJECTS to a command that takes <bucket> <prefix> and prints one object name per line.
list_objects() {
  if [ -n "${SMOKE_LIST_OBJECTS:-}" ]; then "$SMOKE_LIST_OBJECTS" "$BUCKET" "$1"; else "${AWS[@]}" s3 ls "s3://$BUCKET/$1"; fi
}
# Stages with sign-in set SMOKE_AUTH_TOKEN (a Cognito access token) or SMOKE_COOKIE_JAR (a session cookie
# from a hosted login, e.g. an ALB with authenticate-cognito): every request carries it.
curl() { command curl ${SMOKE_AUTH_TOKEN:+-H "Authorization: Bearer $SMOKE_AUTH_TOKEN"} ${SMOKE_COOKIE_JAR:+-b "$SMOKE_COOKIE_JAR"} "$@"; }
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

curl -sf "$API/health" | grep -q '"ok"' && pass "health" || fail "health ($API/health)"
curl -sf "$BASE/" | grep -qi '<div id="root">' && pass "frontend index" || fail "frontend index"

P=$(curl -sf -X POST "$API/plants" -H 'content-type: application/json' \
  -d '{"name":"Smoke Monstera","species":"Monstera deliciosa","water_every_days":7}') || fail "create plant"
ID=$(echo "$P" | json '["id"]'); pass "create plant $ID"

curl -sf "$BASE/plants/$ID" | grep -qi '<div id="root">' && pass "spa deep link" || fail "spa deep link /plants/$ID"

{ printf '\x89PNG\r\n\x1a\n'; head -c $((2*1024*1024)) /dev/urandom; } > "$TMP/big.png"
# -H 'Expect:' : curl asks "100-continue" for uploads over 1 MB; some front doors (the Floci GCP emulator) reject that header, browsers never send it.
M=$(curl -sf -X POST "$API/plants/$ID/media" -H 'Expect:' -F "file=@$TMP/big.png;type=image/png" -F caption=smoke) || fail "upload 2 MiB photo"
MID=$(echo "$M" | json '["id"]'); pass "upload 2 MiB photo"

curl -sf -o "$TMP/dl.png" "$API/media/$MID" || fail "download"
cmp -s "$TMP/big.png" "$TMP/dl.png" && pass "download bytes match" || fail "download bytes differ"
list_objects "plants/$ID/" | grep -q "$MID" && pass "object in bucket $BUCKET" || fail "object missing in the bucket"

# Same request the frontend sends (api.ts always posts a JSON body).
curl -sf -X POST "$API/plants/$ID/water" -H 'content-type: application/json' -d '{}' >/dev/null && pass "water" || fail "water"
[ "$(curl -sf "$API/plants/$ID" | json '["waterings"].__len__()')" = 1 ] && pass "watering recorded" || fail "watering recorded"
[ "$(curl -sf "$API/plants" | python3 -c "import sys,json;print([p['cover_media_id'] for p in json.load(sys.stdin) if p['id']=='$ID'][0])")" = "$MID" ] \
  && pass "list shows cover photo" || fail "list shows cover photo"

[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/plants/$ID")" = 204 ] && pass "delete" || fail "delete"
# SMOKE_ALLOW_SPA_FALLBACK=1: the front door rewrites every 404 into the SPA page (serverless on Floci,
# where CloudFront Functions don't run). The deleted plant must then be gone from the response body.
gone=$(curl -s -w '\n%{http_code}' "$API/plants/$ID")
code=${gone##*$'\n'}
if [ "$code" = 404 ] || { [ "${SMOKE_ALLOW_SPA_FALLBACK:-}" = 1 ] && [ "$code" = 200 ] && ! grep -q "$ID" <<<"${gone%$'\n'*}"; }; then
  pass "gone after delete"
else
  fail "still there after delete (HTTP $code)"
fi
[ -z "$(list_objects "plants/$ID/" || true)" ] && pass "bucket prefix empty" || fail "objects left behind in the bucket"
echo "SMOKE PASSED"
