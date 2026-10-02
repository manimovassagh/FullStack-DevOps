#!/usr/bin/env bash
# SSH into a Floci EC2 instance through the host port Floci maps to its port 22.
# Usage: ssh.sh <instance_id> [remote command...]
set -euo pipefail
ID=${1:?instance id}; shift
DIR=$(cd "$(dirname "$0")/.." && pwd)
C=$(docker ps --format '{{.ID}} {{.Names}}' | awk -v id="$ID" 'index($2, id) {print $1; exit}')
[ -n "$C" ] || { echo "no running container for $ID" >&2; exit 1; }
PORT=$(docker port "$C" 22 | head -1 | awk -F: '{print $NF}')
exec ssh -i "$DIR/build/ssh/id_rsa" -p "$PORT" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@localhost "$@"
