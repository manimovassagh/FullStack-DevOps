#!/usr/bin/env bash
# List object names under a prefix in a Cloud Storage bucket, one per line (the shared smoke test's
# SMOKE_LIST_OBJECTS hook). Uses the JSON API of the emulator; run from deployment/gcp/cloud-run.
# Usage: list-objects.sh <bucket> <prefix>
set -euo pipefail
bucket=${1:?bucket}; prefix=${2:-}
endpoint=${FLOCI_ENDPOINT:-http://localhost:4588}
curl -sf -G "$endpoint/storage/v1/b/$bucket/o" --data-urlencode "prefix=$prefix" | jq -r '.items[]?.name'
