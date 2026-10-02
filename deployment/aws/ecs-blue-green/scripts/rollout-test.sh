#!/usr/bin/env bash
# The blue/green release journey, with an assertion at every step on where user traffic goes.
# Needs a running stack (`make up`) and the local images plant/<svc>:$IMAGE_TAG. Run from deployment/aws/ecs-blue-green.
#
#   release (0%) → preview smoke → canary 50% → promote → rollback → promote → finalize
set -euo pipefail
tag=${IMAGE_TAG:?IMAGE_TAG}
new="$tag-green"
n=${SAMPLES:-30}

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*"; exit 1; }
sample() { scripts/served-by.sh "$n"; }
# expect <label> <blue|green|both>: where did the last sample's traffic go?
expect() {
  local got blue green
  got=$(sample); blue=${got#blue=}; blue=${blue%% *}; green=${got##*green=}
  echo "   $got  (expected: $2)"
  case $2 in
    blue)  [ "$blue" -eq "$n" ] && [ "$green" -eq 0 ] ;;
    green) [ "$green" -eq "$n" ] && [ "$blue" -eq 0 ] ;;
    both)  [ "$blue" -gt 0 ] && [ "$green" -gt 0 ] ;;
  esac || fail "$1: traffic did not go where the release state says ($got)"
}

step "baseline: blue serves everything"
expect baseline blue

step "release $new: green starts with 0% of user traffic"
for svc in backend frontend; do docker tag "plant/$svc:$tag" "plant/$svc:$new"; done
make -s release TAG="$new" >/dev/null
expect "after release" blue

step "preview: smoke-test green through the preview listener, before any user sees it"
make -s preview | tail -1

step "canary 50%: both environments serve"
make -s canary PCT=50 >/dev/null
expect canary both

step "promote: green serves everything, blue is kept for rollback"
make -s promote >/dev/null
expect promote green

step "rollback: all traffic back to blue"
make -s rollback >/dev/null
expect rollback blue

step "promote again, then finalize: the new version becomes the stable blue"
make -s promote >/dev/null
expect "promote again" green
make -s finalize >/dev/null
expect finalize blue
[ "$(jq -r .blue_tag release.auto.tfvars.json)" = "$new" ] || fail "blue is not running $new after finalize"
[ "$(jq -r .green_count release.auto.tfvars.json)" -eq 0 ] || fail "green is still running after finalize"

step "public API smoke test on the finalized release"
SMOKE_QUIET=1 "$(dirname "$0")/../../../smoke/api-smoke.sh" "$(terraform output -raw app_url)" "$(terraform output -raw media_bucket)" | tail -1
echo "ROLLOUT PASSED"
