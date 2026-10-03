#!/usr/bin/env bash
# Replace every instance of both Auto Scaling Groups with a fresh one from the latest launch-template version,
# one instance at a time, without ever dropping below the desired capacity. This is what the AWS feature
# "instance refresh" automates (Floci 2.1.0 does not implement it).
#
# For each old instance: add one instance (the group launches it from $Latest), wait until it is InService and
# every target in the target group is healthy, then terminate the old one and shrink back.
# Run from deployment/aws/ec2-asg.
set -euo pipefail
endpoint=${FLOCI_ENDPOINT:-http://localhost:4566}
tries=${WAIT_TRIES:-120} # x 5 s per step
as() { aws --endpoint-url "$endpoint" --region us-east-1 autoscaling "$@"; }
elb() { aws --endpoint-url "$endpoint" --region us-east-1 elbv2 "$@"; }

# JMESPath literal (the backticks are part of the query, not a command substitution)
# shellcheck disable=SC2016
in_service_query='AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId'
in_service() { as describe-auto-scaling-groups --auto-scaling-group-names "$1" --query "$in_service_query" --output text; }

# the group has exactly $2 InService instances (evaluated on every poll, not once up front)
in_service_count_is() { [ "$(in_service "$1" | wc -w | tr -d ' ')" -eq "$2" ]; }

wait_until() { # <description> <command...>
  local what=$1; shift
  for _ in $(seq 1 "$tries"); do "$@" && return 0; sleep 5; done
  echo "timed out waiting for: $what"; exit 1
}

# all targets of the target group report healthy, and there are $2 of them
targets_healthy() {
  local states
  states=$(elb describe-target-health --target-group-arn "$1" --query 'TargetHealthDescriptions[].TargetHealth.State' --output text)
  [ "$(wc -w <<<"$states")" -eq "$2" ] && ! grep -qE 'unhealthy|initial|draining|unused' <<<"$states"
}

for tier in backend frontend; do
  asg=$(terraform output -json asg_names | jq -r ".$tier")
  tg=$(terraform output -raw "${tier}_target_group_arn")
  desired=$(as describe-auto-scaling-groups --auto-scaling-group-names "$asg" --query 'AutoScalingGroups[0].DesiredCapacity' --output text)
  read -ra old <<<"$(in_service "$asg")"
  echo "== $tier ($asg): replacing ${#old[@]} instance(s): ${old[*]}"

  for id in "${old[@]}"; do
    as set-desired-capacity --auto-scaling-group-name "$asg" --desired-capacity $((desired + 1))
    wait_until "$tier: a new instance InService" in_service_count_is "$asg" $((desired + 1))
    wait_until "$tier: all $((desired + 1)) targets healthy" targets_healthy "$tg" $((desired + 1))
    echo "   new instance is healthy, terminating $id"
    as terminate-instance-in-auto-scaling-group --instance-id "$id" --should-decrement-desired-capacity >/dev/null
    wait_until "$tier: back to $desired target(s), healthy" targets_healthy "$tg" "$desired"
  done
  echo "   $tier now runs: $(in_service "$asg")"
done
