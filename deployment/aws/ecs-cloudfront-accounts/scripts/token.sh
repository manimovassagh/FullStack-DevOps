#!/usr/bin/env bash
# Sign in through the app (POST /api/auth/login) and print the access token.
# Usage: token.sh <base_url> <email> [password]
set -euo pipefail
BASE=${1:?base url}; USER_EMAIL=${2:?email}; PASSWORD=${3:-${DEMO_PASSWORD:-Plant-Parent-2026!}}
curl -sf -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'
