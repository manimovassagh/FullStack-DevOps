#!/usr/bin/env bash
# Print the revision each container app currently serves, as JSON: {"backend":"backend--000003", ...}.
# Read from the emulator's ARM API (not from Terraform state, which records the update's response before the new revision exists).
set -euo pipefail
base="https://localhost:4577/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/plant-rg/providers/Microsoft.App/containerApps"
ca="$(cd "$(dirname "$0")/.." && pwd)/build/ca-bundle.pem"
out='{}'
for app in backend frontend gateway; do
  rev=$(curl -sf --cacert "$ca" "$base/$app?api-version=2025-07-01" | jq -r '.properties.latestReadyRevisionName')
  out=$(jq -c --arg a "$app" --arg r "$rev" '.[$a]=$r' <<<"$out")
done
echo "$out"
