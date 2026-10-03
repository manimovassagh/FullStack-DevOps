#!/usr/bin/env bash
# Print the URL to open the app on: the gateway replica's own published port, e.g. http://localhost:38307.
#
# The emulator's ingress URL (terraform output app_url) answers one-off requests, but it hangs on connections that are
# reused, which is what a browser does. Every Container Apps replica is a Docker container with a published port, so
# the browser talks to the gateway (nginx) directly; nginx calls the emulator with one connection per request.
set -euo pipefail
for _ in $(seq 1 30); do
  c=$(docker ps --format '{{.Names}}' | grep -E '^floci-az-ca-gateway-' | sort | tail -1 || true)
  if [ -n "$c" ]; then
    port=$(docker port "$c" 80 2>/dev/null | head -1 | awk -F: '{print $NF}')
    if [ -n "$port" ]; then echo "http://localhost:$port"; exit 0; fi
  fi
  sleep 2
done
echo "no running gateway replica with a published port" >&2
exit 1
