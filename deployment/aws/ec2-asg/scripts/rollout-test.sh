#!/usr/bin/env bash
# The Auto Scaling Group journey, with an assertion at every step.
#   new launch-template version → running instances unchanged → roll → instances replaced → kill one → the group heals
# Needs a running stack (`make apply`/`make deploy` + `make wait`). Run from deployment/aws/ec2-asg.
set -euo pipefail
endpoint=${FLOCI_ENDPOINT:-http://localhost:4566}
as() { aws --endpoint-url "$endpoint" --region us-east-1 autoscaling "$@"; }
step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*"; exit 1; }
smoke() { ../../smoke/api-smoke.sh "$(terraform output -raw app_url)" "$(terraform output -raw media_bucket)" | tail -1; }
ids() { as describe-auto-scaling-groups --auto-scaling-group-names "$(terraform output -json asg_names | jq -r ".$1")" \
  --query 'AutoScalingGroups[0].Instances[].InstanceId' --output text | tr '\t' '\n' | sort | tr '\n' ' '; }

step "baseline: both groups healthy"
make -s wait >/dev/null
b0=$(ids backend); f0=$(ids frontend); v0=$(terraform output -json launch_template_versions | jq -c .)
echo "   backend: $b0 frontend: $f0 launch templates: $v0"
smoke

step "release: a new launch-template version, but the running instances do not change"
make -s deploy RELEASE=r2 >/dev/null
v1=$(terraform output -json launch_template_versions | jq -c .)
echo "   launch templates: $v1"
[ "$v1" != "$v0" ] || fail "no new launch-template version was created"
if [ "$(ids backend)" != "$b0" ] || [ "$(ids frontend)" != "$f0" ]; then fail "instances changed without a roll"; fi

step "roll: every instance is replaced by one from the new version"
make -s roll >/dev/null
b1=$(ids backend); f1=$(ids frontend)
echo "   backend: $b1 frontend: $f1"
for old in $b0 $f0; do case " $b1$f1" in *" $old "*) fail "instance $old was not replaced";; esac; done
make -s wait >/dev/null; smoke

step "self-healing: terminate a backend instance behind the group's back"
victim=${b1%% *}
aws --endpoint-url "$endpoint" --region us-east-1 ec2 terminate-instances --instance-ids "$victim" >/dev/null
echo "   terminated $victim"
for _ in $(seq 1 60); do
  now=$(ids backend)
  case " $now" in *" $victim "*) ;; *) [ -n "${now// /}" ] && break;; esac
  sleep 5
done
case " $now" in *" $victim "*) fail "the group did not replace $victim";; esac
echo "   backend now: $now"
make -s wait >/dev/null; smoke
echo "ROLLOUT PASSED"
