#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# CloudFront is the only way in: the same API call works through CloudFront and is refused when it goes to the
# load balancer directly, even with a guessed secret header. The page comes from S3, not from a container.
# Usage: origin-lock.sh <app_url (CloudFront)> <alb_url (direct)>
set -euo pipefail
APP=${1:?CloudFront url}; ALB=${2:?ALB url}
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# --- through CloudFront
[ "$(code "$APP/api/health")" = 200 ] && pass "API through CloudFront → 200" || fail "API through CloudFront: $(code "$APP/api/health")"
curl -s "$APP/" | grep -qi '<div id="root">' && pass "page through CloudFront (from S3)" || fail "CloudFront does not serve the app page"

# --- around CloudFront
[ "$(code "$ALB/api/health")" = 403 ] && pass "ALB directly → 403" || fail "ALB answered a direct request: $(code "$ALB/api/health")"
[ "$(code -H 'X-Origin-Verify: guess' "$ALB/api/health")" = 403 ] && pass "ALB with a guessed secret → 403" || fail "ALB accepted a guessed secret"
[ "$(code "$ALB/")" = 403 ] && pass "ALB has no page to serve → 403 (the app lives in S3)" || fail "ALB served something at /"

echo "ORIGIN LOCK PASSED"
