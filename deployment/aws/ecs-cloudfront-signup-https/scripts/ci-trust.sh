#!/usr/bin/env bash
# For CI: a throwaway local CA that this job trusts, so `make tls` can sign the stage's certificate and curl,
# Node and the test browser accept it. The same tool and flow as on a laptop (mkcert), minus the keychain.
#   - installs mkcert when the runner does not have it (the local-CI job image does; GitHub's hosted runners do not)
#   - puts the CA in the system store and, when `certutil` exists, in the NSS store Chromium reads
# Prints `CAROOT=<dir>` and `NODE_EXTRA_CA_CERTS=<ca file>` so the workflow can export them (`>> "$GITHUB_ENV"`):
# `make tls` signs with that CA, and Node (the test runner's own requests) trusts it.
set -euo pipefail
if ! command -v mkcert >/dev/null; then
  arch=$(dpkg --print-architecture 2>/dev/null || { [ "$(uname -m)" = aarch64 ] && echo arm64 || echo amd64; })
  sudo curl -sfL "https://dl.filippo.io/mkcert/latest?for=linux/$arch" -o /usr/local/bin/mkcert && sudo chmod +x /usr/local/bin/mkcert
  command -v certutil >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq libnss3-tools; } >&2
fi
CAROOT=$(mktemp -d)
export CAROOT
mkcert -install >&2
echo "CAROOT=$CAROOT"
echo "NODE_EXTRA_CA_CERTS=$CAROOT/rootCA.pem"
