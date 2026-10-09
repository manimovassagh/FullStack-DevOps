# Floci notes for ecs-alb-auth

## Its own emulator, a dated nightly

`compose.yaml` runs `floci/floci:nightly-10012026` on :4569, with the ALB listener published on :8097. The pinned release used by the other stages (2.1.0) has no ALB authentication. Checked in the binaries on 2026-10-09: the nightly contains `authenticate-cognito`, `AuthenticateCognitoConfig`, the ALB callback path `/oauth2/idpresponse` and `AWSELBAuthSessionCookie`, and 2.1.0 contains none of them. Move to a release once one has them.

## HTTP listener on Floci

Real ALBs accept authenticate actions only on HTTPS listeners. Floci has no ACM, so `on_floci = true` makes the listener plain HTTP on port 80. On real AWS, set `on_floci = false`, `certificate_arn` and `public_url`: the listener moves to 443 and the Cognito callback becomes `<public_url>/oauth2/idpresponse`.

## Not verified yet

The stage was merged before its first live run (fix forward). Still to record here after `make smoke`:

- the hosted-login URL Floci redirects to, and whether it is reachable from the host
- the login form's input names (`hosted-login.mjs` expects `username` and `password`, like real Cognito)
- whether the `x-amzn-oidc-identity`, `x-amzn-oidc-accesstoken` and `x-amzn-oidc-data` headers reach the targets (the names are not in the binary as literals; the stage does not depend on them)
