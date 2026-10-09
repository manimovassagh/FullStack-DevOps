#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# What the load balancer is told to do, read back from its API: every path signs in with Cognito before it
# forwards; pages get the hosted login, the API gets 401. On Floci this is all we can check, because Floci stores
# these actions but does not enforce them (FLOCI-NOTES.md). On real AWS, scripts/auth-rules.sh checks the behaviour.
# Usage: listener-config.sh <aws endpoint url> <load balancer name>
set -euo pipefail
EP=${1:?aws endpoint url}; NAME=${2:?load balancer name}
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
a() { aws --endpoint-url "$EP" "$@"; }

lb=$(a elbv2 describe-load-balancers --names "$NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text) || fail "no load balancer $NAME"
listener=$(a elbv2 describe-listeners --load-balancer-arn "$lb" --query 'Listeners[0].ListenerArn' --output text)

# "<order>:<type>:<on unauthenticated request>" for each action, in order
actions() { jq -r 'sort_by(.Order)[] | "\(.Order):\(.Type):\(.AuthenticateCognitoConfig.OnUnauthenticatedRequest // "-")"' | paste -sd' ' -; }

d=$(a elbv2 describe-listeners --listener-arns "$listener" --query 'Listeners[0].DefaultActions' --output json | actions)
[ "$d" = "1:authenticate-cognito:authenticate 2:forward:-" ] && pass "pages: sign in (redirect to the hosted login), then forward" || fail "default actions: $d"

r=$(a elbv2 describe-rules --listener-arn "$listener" --output json \
  | jq '[.Rules[] | select(any(.Conditions[]?; .Field == "path-pattern" and (.Values // .PathPatternConfig.Values | index("/api/*"))))][0].Actions')
[ "$r" != null ] || fail "no /api/* rule"
r=$(echo "$r" | actions)
[ "$r" = "1:authenticate-cognito:deny 2:forward:-" ] && pass "API: sign in or 401 (deny), then forward" || fail "/api/* actions: $r"

cfg=$(a elbv2 describe-listeners --listener-arns "$listener" --output json \
  | jq -r '.Listeners[0].DefaultActions[] | select(.Type == "authenticate-cognito") | .AuthenticateCognitoConfig | "\(.UserPoolArn) \(.UserPoolClientId)"')
read -r pool client <<<"$cfg"
secret=$(a cognito-idp describe-user-pool-client --user-pool-id "${pool##*/}" --client-id "$client" --query 'UserPoolClient.ClientSecret' --output text)
[ -n "$secret" ] && [ "$secret" != None ] && pass "the ALB's app client is confidential (has a secret)" || fail "app client has no secret"

echo "LISTENER CONFIG PASSED"
