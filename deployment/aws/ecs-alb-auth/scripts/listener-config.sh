#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# Real AWS only: the listener rules alb.tf creates, read back from the API (on Floci the proxy in proxy.tf does
# this job instead, and scripts/auth-rules.sh checks the behaviour on both).
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
[ "$d" = "1:authenticate-cognito:allow 2:forward:-" ] && pass "pages: open, signed-in visitors carry their identity" || fail "default actions: $d"

# "<path>|<methods>" → "<actions>" for every rule that is not the default
rules=$(a elbv2 describe-rules --listener-arn "$listener" --output json | jq -r '.Rules[] | select(.IsDefault | not)
  | "\([.Conditions[] | select(.Field == "path-pattern") | (.Values // .PathPatternConfig.Values)[]] | join(","))|\([.Conditions[] | select(.Field == "http-request-method") | .HttpRequestMethodConfig.Values[]] | join(","))|\(.Actions | tostring)"')
rule() { echo "$rules" | grep -F "$1|$2|" | cut -d'|' -f3- | actions; }
[ "$(rule /oauth2/start "")" = "1:authenticate-cognito:authenticate 2:redirect:-" ] && pass "sign-in link: hosted login, then home" || fail "sign-in rule"
[ "$(rule '/api/*' POST,PUT,PATCH,DELETE)" = "1:authenticate-cognito:deny 2:forward:-" ] && pass "API changes: session or 401" || fail "API write rule"
[ "$(rule '/api/*' "")" = "1:authenticate-cognito:allow 2:forward:-" ] && pass "API reads: open" || fail "API read rule"

cfg=$(a elbv2 describe-listeners --listener-arns "$listener" --output json \
  | jq -r '.Listeners[0].DefaultActions[] | select(.Type == "authenticate-cognito") | .AuthenticateCognitoConfig | "\(.UserPoolArn) \(.UserPoolClientId)"')
read -r pool client <<<"$cfg"
secret=$(a cognito-idp describe-user-pool-client --user-pool-id "${pool##*/}" --client-id "$client" --query 'UserPoolClient.ClientSecret' --output text)
[ -n "$secret" ] && [ "$secret" != None ] && pass "the ALB's app client is confidential (has a secret)" || fail "app client has no secret"

echo "LISTENER CONFIG PASSED"
