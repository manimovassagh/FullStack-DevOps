#!/usr/bin/env bash
# Keep each ALB target group in sync with the cluster's nodes: register every
# node's InternalIP on the Service's NodePort, deregister nodes that are gone.
# On real AWS the AWS Load Balancer Controller does this (TargetGroupBinding).
# Usage: register-nodes.sh   (run from deployment/aws/eks, needs KUBECONFIG + AWS env)
set -euo pipefail
AWS=(aws --endpoint-url "${FLOCI_ENDPOINT:-http://localhost:4566}")

nodes=$(kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}')
[ -n "$nodes" ] || { echo "no nodes found"; exit 1; }

# Floci: the k3s node reports its address on Docker's default bridge, which the
# ALB (inside the Floci container) can't reach. Use the node container's address
# on the network Floci shares with it instead (see FLOCI-NOTES.md).
if [ -n "${FLOCI_NETWORK:-}" ]; then
  nodes=$(docker inspect "floci-eks-$(terraform output -raw cluster)" \
    --format "{{(index .NetworkSettings.Networks \"$FLOCI_NETWORK\").IPAddress}}")
fi

tgs=$(terraform output -json target_group_arns)
ports=$(terraform output -json node_ports)

for svc in frontend backend; do
  tg=$(echo "$tgs" | python3 -c "import sys,json;print(json.load(sys.stdin)['$svc'])")
  port=$(echo "$ports" | python3 -c "import sys,json;print(json.load(sys.stdin)['$svc'])")
  current=$("${AWS[@]}" elbv2 describe-target-health --target-group-arn "$tg" \
    --query 'TargetHealthDescriptions[].Target.Id' --output text | tr '\t' '\n')

  for ip in $nodes; do
    grep -qx "$ip" <<<"$current" || {
      "${AWS[@]}" elbv2 register-targets --target-group-arn "$tg" --targets "Id=$ip,Port=$port"
      echo "$svc: registered $ip:$port"
    }
  done
  for ip in $current; do
    grep -qx "$ip" <<<"$nodes" || {
      "${AWS[@]}" elbv2 deregister-targets --target-group-arn "$tg" --targets "Id=$ip,Port=$port"
      echo "$svc: deregistered $ip:$port"
    }
  done
done
