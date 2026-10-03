#!/bin/bash
# Shared UserData prelude: logging, base packages, AWS CLI v2.
set -euxo pipefail
exec > >(tee -a /var/log/user-data.log) 2>&1

# Wait for systemd if this image runs it (baked cloud image); harmless otherwise.
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  systemctl is-system-running --wait || true
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl unzip jq

if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscliv2.zip
fi
