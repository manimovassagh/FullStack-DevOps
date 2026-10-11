#!/usr/bin/env bash
# For CI: a throwaway local CA that this job trusts, so `make tls` can sign the stage's certificate and curl,
# Node and the test browser accept it. The same tool and flow as on a laptop (mkcert), minus the keychain.
#   - installs mkcert when the runner does not have it (the local-CI job image does; GitHub's hosted runners do not)
#   - puts the CA in the system store and, when `certutil` exists, in the NSS store Chromium reads
# Prints `CAROOT=<dir>` and `NODE_EXTRA_CA_CERTS=<ca file>` so the workflow can export them (`>> "$GITHUB_ENV"`):
# `make tls` signs with that CA, and Node (the test runner's own requests) trusts it.
set -euo pipefail
if ! command -v mkcert >/dev/null; then
  # a pinned release, verified against its checksum (keep in step with platform/local-ci/runner-image/Dockerfile)
  arch=$(dpkg --print-architecture 2>/dev/null || { [ "$(uname -m)" = aarch64 ] && echo arm64 || echo amd64; })
  case "$arch" in
    arm64) sum=b98f2cc69fd9147fe4d405d859c57504571adec0d3611c3eefd04107c7ac00d0 ;;
    *)     sum=6d31c65b03972c6dc4a14ab429f2928300518b26503f58723e532d1b0a3bbb52 ;;
  esac
  tmp=$(mktemp)
  curl -sfL "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-$arch" -o "$tmp"
  echo "$sum  $tmp" | sha256sum -c - >&2
  sudo install -m 0755 "$tmp" /usr/local/bin/mkcert; rm -f "$tmp"
  command -v certutil >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq libnss3-tools; } >&2
fi
CAROOT=$(mktemp -d)
export CAROOT
mkcert -install >&2
# Chromium on Linux trusts what is in the NSS database ~/.pki/nssdb. `mkcert -install` only writes there when that
# database already exists, and in a fresh job container it does not: create it and add the CA explicitly (without
# this the browser tests get net::ERR_CERT_AUTHORITY_INVALID while curl, which uses the system store, is fine).
if command -v certutil >/dev/null; then
  mkdir -p "$HOME/.pki/nssdb"
  [ -f "$HOME/.pki/nssdb/cert9.db" ] || certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password
  certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n "mkcert local CA (CI)" -i "$CAROOT/rootCA.pem"
fi
echo "CAROOT=$CAROOT"
echo "NODE_EXTRA_CA_CERTS=$CAROOT/rootCA.pem"
