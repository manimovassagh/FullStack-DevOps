#!/usr/bin/env bash
# Start one workflow on the local Gitea and wait for it. Usage: ./dispatch.sh <workflow.yml> [branch]
set -euo pipefail
WF=${1:?workflow file, e.g. ecs-cognito.yml}; REF=${2:-ci-test}
q() { docker exec plant-ci-gitea-1 sqlite3 -cmd '.timeout 8000' /data/gitea/gitea.db "$1" 2>/dev/null; }
before=$(q "select coalesce(max(id),0) from action_run")
curl -sf -u "${ADMIN_USER:-ci}:${ADMIN_PASS:-ci-password-1}" -X POST \
  "http://localhost:3300/api/v1/repos/ci/FullStack-DevOps/actions/workflows/$WF/dispatches" \
  -H 'content-type: application/json' -d "{\"ref\":\"$REF\"}"
sleep 5; run=$(q "select max(id) from action_run"); [ "$run" -gt "$before" ] || { echo "no run was created for $WF"; exit 1; }
while [ "$(q "select count(*) from action_run_job where run_id=$run and status in (5,6,7)")" != 0 ]; do sleep 10; done
q "select j.name || ' -> ' || case j.status when 1 then 'success' when 2 then 'FAILED' when 3 then 'cancelled' when 4 then 'skipped' else j.status end from action_run_job j where run_id=$run order by id"
[ "$(q "select count(*) from action_run_job where run_id=$run and status<>1")" = 0 ]
