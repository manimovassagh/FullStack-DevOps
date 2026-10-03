#!/usr/bin/env bash
# The GitOps journey: every change is a commit, and Argo CD makes the cluster match it.
#   release a tag (commit) → revert it (commit) → change the cluster by hand → Argo CD heals the drift
# Needs a running stack (`make up`) and the local images plant/<svc>:$IMAGE_TAG. Run from deployment/aws/eks-gitops.
set -euo pipefail
tag=${IMAGE_TAG:?IMAGE_TAG}
new="$tag-gitops"

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*"; exit 1; }
backend_image() { kubectl -n plant get deploy backend -o jsonpath='{.spec.template.spec.containers[0].image}'; }
smoke() { ../../smoke/api-smoke.sh "$(terraform output -raw app_url)" "$(terraform output -raw media_bucket)" | tail -1; }

step "baseline: Argo CD deployed git's current commit"
scripts/wait-synced.sh >/dev/null
before=$(backend_image); echo "   backend $before"

step "release $new: a commit that changes the image tag"
for svc in backend frontend; do docker tag "plant/$svc:$tag" "plant/$svc:$new"; done
make -s release TAG="$new" >/dev/null
after=$(backend_image); echo "   backend $after"
if [ "${after##*:}" != "$new" ]; then fail "the cluster did not move to $new"; fi
make -s wait >/dev/null; smoke

step "rollback: git revert of that commit"
make -s revert >/dev/null
reverted=$(backend_image); echo "   backend $reverted"
[ "$reverted" = "$before" ] || fail "revert did not restore $before (got $reverted)"
make -s wait >/dev/null; smoke

step "drift: scale the backend by hand; self-heal must put it back to what git says"
want=$(kubectl -n plant get deploy backend -o jsonpath='{.spec.replicas}')
kubectl -n plant scale deploy backend --replicas=1 >/dev/null
echo "   scaled to 1 by hand (git says $want)"
for _ in $(seq 1 36); do # up to 3 minutes
  now=$(kubectl -n plant get deploy backend -o jsonpath='{.spec.replicas}')
  [ "$now" = "$want" ] && break
  sleep 5
done
[ "$now" = "$want" ] || fail "Argo CD did not heal the drift (replicas still $now, git says $want)"
echo "   healed back to $now"
scripts/wait-synced.sh >/dev/null
echo "ROLLOUT PASSED"
