#!/usr/bin/env bash
# Delete every object in a bucket (the emulator's force_destroy can loop on leftovers). Usage: empty-bucket.sh <bucket>
set -euo pipefail
bucket=${1:?bucket}
endpoint=${FLOCI_ENDPOINT:-http://localhost:4588}
"$(dirname "$0")/list-objects.sh" "$bucket" "" | while read -r name; do
  curl -sf -X DELETE "$endpoint/storage/v1/b/$bucket/o/$(jq -rn --arg n "$name" '$n|@uri')" >/dev/null || true
done
