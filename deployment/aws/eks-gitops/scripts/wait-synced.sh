#!/usr/bin/env bash
# Block until Argo CD has deployed the latest commit of the git remote and the app is Synced + Healthy.
# Run from deployment/aws/eks-gitops (needs KUBECONFIG, as `make` sets it).
set -euo pipefail
work=build/work
tries=${WAIT_TRIES:-90} # × 5 s

for _ in $(seq 1 "$tries"); do
  git -C "$work" fetch -q origin main 2>/dev/null || true
  want=$(git -C "$work" rev-parse origin/main 2>/dev/null || echo "")
  read -r sync health rev < <(kubectl -n argocd get application plant \
    -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revision}{"\n"}' 2>/dev/null || echo "? ? ?")
  if [ "$sync" = Synced ] && [ "$health" = Healthy ] && [ "$rev" = "$want" ]; then
    echo "argocd: Synced, Healthy at ${rev:0:7}"
    exit 0
  fi
  sleep 5
done
echo "argocd did not reach Synced/Healthy at ${want:0:7} (sync=$sync health=$health rev=${rev:0:7})"
kubectl -n argocd get application plant -o jsonpath='{.status.conditions}' || true
exit 1
