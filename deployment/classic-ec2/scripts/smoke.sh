#!/usr/bin/env bash
# End-to-end check through the ALB: the same journey a user takes in the browser.
# Usage: smoke.sh <base_url> <media_bucket>
set -euo pipefail
BASE=${1:?base url}; BUCKET=${2:?media bucket}
API="$BASE/api"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
AWS=(aws --endpoint-url "${FLOCI_ENDPOINT:-http://localhost:4566}" --region us-east-1)
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
M=$(curl -sf -X POST "$API/plants/$ID/media" -F "file=@$TMP/big.png;type=image/png" -F caption=smoke) || fail "upload 2 MiB photo"
MID=$(echo "$M" | json '["id"]'); pass "upload 2 MiB photo"

curl -sf -o "$TMP/dl.png" "$API/media/$MID" || fail "download"
cmp -s "$TMP/big.png" "$TMP/dl.png" && pass "download bytes match" || fail "download bytes differ"
"${AWS[@]}" s3 ls "s3://$BUCKET/plants/$ID/" | grep -q "$MID" && pass "object in s3://$BUCKET" || fail "object missing in S3"

curl -sf -X POST "$API/plants/$ID/water" >/dev/null && pass "water" || fail "water"
[ "$(curl -sf "$API/plants/$ID" | json '["waterings"].__len__()')" = 1 ] && pass "watering recorded" || fail "watering recorded"
[ "$(curl -sf "$API/plants" | python3 -c "import sys,json;print([p['cover_media_id'] for p in json.load(sys.stdin) if p['id']=='$ID'][0])")" = "$MID" ] \
  && pass "list shows cover photo" || fail "list shows cover photo"

[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/plants/$ID")" = 204 ] && pass "delete" || fail "delete"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API/plants/$ID")" = 404 ] && pass "gone after delete" || fail "still there after delete"
[ -z "$("${AWS[@]}" s3 ls "s3://$BUCKET/plants/$ID/" || true)" ] && pass "S3 prefix empty" || fail "S3 objects left behind"
echo "SMOKE PASSED"
