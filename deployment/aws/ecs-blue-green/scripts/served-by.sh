#!/usr/bin/env bash
# Send N requests through the public listener and count how many each environment's backend served.
# Prints one line, e.g. `blue=9 green=1`. Run from deployment/aws/ecs-blue-green.
#
# Every request carries a unique marker in its query string; the Go backend logs each request's URI,
# so counting that marker in the backend task containers' logs tells which environment answered.
# (The ALB's own health checks hit /api/health, which never carries the marker.)
set -euo pipefail
n=${1:-20}
endpoint=${FLOCI_ENDPOINT:-http://localhost:4566}
url=$(terraform output -raw app_url)
marker="m$(date +%s)$RANDOM"
aws_ecs() { aws --endpoint-url "$endpoint" --region us-east-1 ecs "$@"; }

for _ in $(seq 1 "$n"); do
  curl -s -o /dev/null "$url/api/plants?$marker=1"
done
sleep 1 # let the container log flush

out=""
for color in blue green; do
  count=0
  for arn in $(aws_ecs list-tasks --cluster "$(terraform output -raw cluster)" --service-name "$color-backend" --query 'taskArns[]' --output text); do
    id=${arn##*/}
    c=$(docker logs "floci-ecs-$id-backend" 2>&1 | grep -c "$marker" || true)
    count=$((count + c))
  done
  out="$out$color=$count "
done
echo "${out% }"
