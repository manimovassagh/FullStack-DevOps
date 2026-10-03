#!/usr/bin/env bash
# Print the Docker address of a container (waits up to a minute for it to exist). Usage: container-address.sh <name>
# The Floci Azure emulator and everything it starts live on Docker's default bridge network, where containers
# reach each other by IP but not by name; the Makefile passes these addresses to Terraform.
set -euo pipefail
name=${1:?container name}
for _ in $(seq 1 30); do
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$name" 2>/dev/null || true)
  if [ -n "$ip" ]; then echo "$ip"; exit 0; fi
  sleep 2
done
echo "no address for container $name" >&2
exit 1
