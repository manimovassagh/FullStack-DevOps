#!/usr/bin/env bash
# The release state machine. It only edits release.auto.tfvars.json (which Terraform loads);
# `make` runs terraform apply afterwards. Run from deployment/aws/ecs-blue-green.
#
#   init <tag>      blue runs <tag> and takes 100% of traffic; green is off
#   release <tag>   start green on <tag> with 0% of user traffic (reachable on the preview port)
#   canary <pct>    send <pct>% of user traffic to green
#   promote         send 100% to green (blue keeps running, so rolling back is instant)
#   rollback        send 0% to green again
#   finalize-1      blue takes green's tag (green still serves 100% while blue is replaced)
#   finalize-2      0% to green, green off: the new version is now the stable blue
#   abort           stop green (only while it has 0% of traffic)
#   show            print the state
set -euo pipefail
F=release.auto.tfvars.json
cmd=${1:?command}; arg=${2:-}

get() { jq -r ".$1" "$F"; }
set_state() { jq "$1" "$F" > "$F.tmp" && mv "$F.tmp" "$F"; }
# need <key> <-eq|-gt> <number>, e.g. `need green_count -gt 0`
need() {
  local value
  value=$(get "$1")
  case $2 in
    -eq) [ "$value" -eq "$3" ] ;;
    -gt) [ "$value" -gt "$3" ] ;;
    *) echo "need: bad operator $2"; exit 2 ;;
  esac || { echo "release.sh $cmd: refused, $1 is $value (need $2 $3)"; exit 1; }
}

case $cmd in
  init)
    [ -n "$arg" ] || { echo "init needs a tag"; exit 1; }
    echo '{}' | jq --arg t "$arg" '{blue_tag:$t, green_tag:"", blue_count:1, green_count:0, green_weight:0}' > "$F" ;;
  release)
    [ -n "$arg" ] || { echo "release needs a tag"; exit 1; }
    need green_count -eq 0
    set_state ".green_tag=\"$arg\" | .green_count=1 | .green_weight=0" ;;
  canary)
    [[ $arg =~ ^[0-9]+$ ]] && [ "$arg" -ge 0 ] && [ "$arg" -le 100 ] || { echo "canary needs a percentage 0-100"; exit 1; }
    need green_count -gt 0
    set_state ".green_weight=$arg" ;;
  promote)
    need green_count -gt 0
    set_state ".green_weight=100" ;;
  rollback)
    need green_count -gt 0
    set_state ".green_weight=0" ;;
  finalize-1)
    need green_weight -eq 100
    set_state ".blue_tag=.green_tag" ;;
  finalize-2)
    need green_weight -eq 100
    set_state ".green_weight=0 | .green_count=0 | .green_tag=\"\"" ;;
  abort)
    need green_weight -eq 0
    set_state ".green_count=0 | .green_tag=\"\"" ;;
  show)
    jq -c . "$F"; exit 0 ;;
  *) echo "unknown command: $cmd"; exit 1 ;;
esac
jq -c . "$F"
