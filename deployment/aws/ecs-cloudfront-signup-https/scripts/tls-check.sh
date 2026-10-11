#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# What makes this stage HTTPS and not just "a URL that starts with https": a certificate that matches the name and
# is valid, modern TLS only, no plain HTTP served on the TLS port, HSTS, and the sign-in cookie marked Secure.
# Usage: tls-check.sh <https app url, e.g. https://plant-signup-https.localhost:4443>
set -euo pipefail
URL=${1:?https app url}; HOSTPORT=${URL#https://}; HOST=${HOSTPORT%%:*}; PORT=${HOSTPORT##*:}
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

# --- the certificate
[ "$(code "$URL/")" = 200 ] && pass "HTTPS answers 200 and the certificate is trusted (no -k)" || fail "HTTPS request failed (is the CA trusted? make tls)"
cert=$(echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null | openssl x509 -noout -ext subjectAltName -enddate 2>/dev/null)
echo "$cert" | grep -q "DNS:$HOST" && pass "certificate names $HOST" || fail "certificate does not name $HOST"
end=$(echo "$cert" | sed -n 's/^notAfter=//p')
[ -n "$end" ] && openssl x509 -checkend $((30*86400)) -noout <<<"$(echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null | openssl x509)" >/dev/null \
  && pass "valid for at least 30 more days (until $end)" || fail "certificate expires within 30 days or has no end date"

# --- protocol
[ "$(code --tlsv1.2 "$URL/")" = 200 ] && pass "TLS 1.2 or newer accepted" || fail "TLS 1.2 refused"
if curl -s -o /dev/null --max-time 10 --tls-max 1.1 "$URL/" 2>/dev/null; then fail "TLS 1.1 or older was accepted"; else pass "TLS 1.1 and older refused"; fi
plain=$(code "http://$HOST:$PORT/" || true)
[ "$plain" != 200 ] && pass "plain HTTP on the TLS port is not served (got $plain)" || fail "the app answered over plain HTTP on the TLS port"

# --- headers and cookies
curl -sI --max-time 10 "$URL/" | tr -d '\r' | grep -qi '^strict-transport-security: ' && pass "HSTS header (Strict-Transport-Security) is sent" || fail "no HSTS header"
hdr=$(curl -si --max-time 10 -X POST "$URL/api/auth/login" -H 'content-type: application/json' \
  -d '{"username":"alice@plant.example","password":"Plant-Parent-2026!"}' | tr -d '\r')
ck=$(echo "$hdr" | grep -i '^set-cookie: plant_refresh' || true)
[ -n "$ck" ] && pass "sign-in sets the refresh cookie" || fail "no refresh cookie on sign-in"
echo "$ck" | grep -qi 'secure' && echo "$ck" | grep -qi 'httponly' && echo "$ck" | grep -qi 'samesite=strict' \
  && pass "… marked Secure; HttpOnly; SameSite=Strict" || fail "refresh cookie is missing a flag: $ck"

echo "TLS CHECKS PASSED"
