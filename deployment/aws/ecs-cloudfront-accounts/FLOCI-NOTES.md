# Floci notes for ecs-cloudfront-accounts (from ecs-cloudfront, plus the accounts section at the end)

## Its own emulator, a dated nightly

`compose.yaml` runs `floci/floci:nightly-10012026` on :4572. In 2.1.0 a POST, PUT or DELETE sent through a CloudFront distribution gets an empty `405` (see the serverless stage), and the API sits behind CloudFront here. The ALB listener is also published on :8099, only so `scripts/origin-lock.sh` can show that calling it directly is refused.

## CloudFront on Floci (same workarounds as the serverless stages)

- **App URL:** a distribution alias, `plant-accounts.localhost:4572` (`*.localhost` resolves to 127.0.0.1; Floci routes by the Host header). On AWS: the `*.cloudfront.net` domain.
- **The ALB origin is `localhost` on the listener port.** Floci's CloudFront and its ALB listeners run in the same process, and CloudFront refuses origins that resolve to local addresses unless allow-listed (`FLOCI_SERVICES_CLOUDFRONT_ALLOWED_PRIVATE_ORIGIN_HOSTS: localhost`). On AWS the origin is the ALB's DNS name.
- **CloudFront Functions are stored, not run.** Locally a distribution-wide error page turns S3's 403/404 into `index.html`, which also rewrites the API's own 404s. `make smoke` sets `SMOKE_ALLOW_SPA_FALLBACK=1` for that; on AWS the function does the SPA routing and real 404s come through.

## The ALB lock

Floci implements `fixed-response` actions and `http-header` listener conditions (both present in the nightly binary). The managed prefix list for CloudFront does not exist on Floci, so with `on_floci` the ALB security group is open and only the secret header locks it.

## Not verified yet

Written before the first live run (fix forward). After `make up smoke`, record here whether the custom header reaches the ALB rule and whether OAC-signed reads of the private bucket work.

## Accounts (this stage, verified 2026-10-11)

- **Cognito endpoint in the provider:** the copied provider block had no `cognitoidp` endpoint, so `CreateUserPool` went to real AWS with the test keys ("security token … invalid"). Every service a stage uses needs its line in `endpoints`.
- **Emails:** Floci sends Cognito's codes to its SES inbox (`GET /_aws/ses`). The list order is not fixed: sort by `Timestamp`.
- **Sign-up, confirm, resend, forgot/reset, change password, update attributes, global sign-out:** all work. Global sign-out revokes the access token at once for Cognito calls (`GetUser` → 401). The API's own JWT check accepts that token until it expires (60 min), as on real AWS.
- **Unconfirmed sign-in answers 401 (`code: not_confirmed`), not 403:** on Floci, CloudFront's 403/404 → `index.html` stand-in for the SPA function applies to `/api/*` too and turned the API's 403 into the app's page.
- **OrbStack registry trust:** `docker push` to this Floci's ECR (:4572) needs the port in `~/.orbstack/config/docker.json` `insecure-registries` (added 2026-10-11 with 4573–4575 as spares).
