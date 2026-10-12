# 0007. HTTPS terminates in Caddy, not in the emulator

Status: accepted

## Context
The lab should look like a real deployment (Secure cookies, HSTS, mixed-content rules), but emulators and apps speak plain HTTP.

## Decision
A Caddy container terminates TLS with a certificate from a local CA (mkcert) and routes by host name to what runs today. Apps and emulators stay on HTTP behind it. Local CI keeps plain HTTP inside job containers; the HTTPS stage in CI makes a throwaway CA and trusts it, in curl and in Chromium.

## Consequences
- The proxy must pass the original `Host` header, because Floci's CloudFront routes by it.
- Cookies can be `Secure` locally, as on AWS.
- CloudFront to the ALB stays plain HTTP, listed under known simplifications in `docs/PLATFORM-ROADMAP.md`.
