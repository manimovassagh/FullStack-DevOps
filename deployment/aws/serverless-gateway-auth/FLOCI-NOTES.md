# Floci notes for serverless-gateway-auth

Copied from serverless-cognito (verified there against the Floci nightly `nightly-10012026`, pinned in [compose.yaml](compose.yaml)); ports and names adjusted.

## This stage runs its own Floci

The other stages use the shared Floci 2.1.0 (port 4566, root `docker-compose.yml`). This one starts its own on **port 4567**. Reason: in 2.1.0, a POST, PUT or DELETE sent to a CloudFront distribution gets an empty `405` and never reaches the origin; only GET and HEAD work. The API sits behind CloudFront, so creating a plant would fail. The nightly forwards every method. Switch `compose.yaml` to a release tag once one contains this, and the stage can share the main Floci again.

## What works like real AWS

- **Lambda runs your binary in a container.** `provided.al2023` with a static Go binary named `bootstrap`, started on demand by Floci (the first call is a cold start). Logs go to CloudWatch Logs.
- **API Gateway HTTP API (v2)** with an `AWS_PROXY` integration (payload format 2.0), a route with a `{proxy+}` path and a named stage.
- **CloudFront** with two origins (S3 and a custom origin), a path-based cache behavior (`api/*`), managed cache policies, and a viewer alias. Origin access control and the bucket policy are created and accepted.
- **Secrets Manager from inside the function.** The function reads the database URL at cold start.

## Differences

- **App URL.** CloudFront is reached through a distribution *alias*: `plant.localhost` resolves to 127.0.0.1 in browsers and curl, and Floci routes by that Host header. On AWS the URL is the `*.cloudfront.net` domain. (`{id}.cloudfront.localhost` is documented but did not route in the builds I tried.)
- **The API origin is `localhost`.** Floci's own process cannot resolve API Gateway's `*.execute-api.localhost.floci.io` hostname, and CloudFront refuses origins that resolve to local addresses unless they are allow-listed. So `compose.yaml` allow-lists `localhost`, and with `var.on_floci` the origin is `localhost` plus Floci's path form `/execute-api/<api-id>/live`. On AWS it is `<api-id>.execute-api.<region>.amazonaws.com` plus `/live`.
- **CloudFront Functions are stored, not run.** On AWS a viewer-request function sends every extension-less path to `/index.html`, which is what makes `/plants/123` work in a single-page app. Locally the function is skipped (`count = 0`) and a distribution-wide custom error response turns S3's 404 into `index.html` instead. That also rewrites the API's own 404s (a deleted plant returns the app page, status 200), so `deployment/smoke/api-smoke.sh` accepts that when `SMOKE_ALLOW_SPA_FALLBACK=1` (set by `make smoke`): the response must then not contain the deleted plant. On AWS the real 404 comes through.
- **Alias version.** Floci's `CreateFunction` response does not report the published version, so `aws_lambda_function.version` and the alias show `$LATEST`. The rollout test therefore compares the `X-Release` response header, which the function sets from its `RELEASE` environment variable.
- **VPC, NAT and security groups are metadata.** The function runs in a Docker container; Floci only needs the compose network (`FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK`) so it can reach RDS and S3.
- **In-Floci address.** The function reaches Floci's S3 and Secrets Manager at the address RDS reports (`AWS_ENDPOINT_URL`, set only when `var.on_floci`). `localhost` would be the function's own container.
- **Limits not emulated.** Real Lambda caps the request body at 6 MB (base64 adds a third), so `MAX_UPLOAD_BYTES` is 4 MiB. Floci does not enforce the cap, but the setting is kept so the behavior matches AWS.

## Cognito on this stage

- Tokens carry `iss = http://localhost:4566/<pool>` (Floci's address inside its container), not the host port 4570: `var.cognito_issuer_base` sets it for the function's `COGNITO_ISSUER`.
- The CloudFront 404 → `/index.html` rewrite above also hides the API's 404s, so `scripts/auth-smoke.sh` counts the SPA page as "refused" on Floci, as long as the other user's data is not in it. On AWS the CloudFront Function keeps API 404s as they are.

## JWT authorizer (verified live 2026-10-10: everything passes)

`make up smoke check rollout` all pass on `nightly-10012026`: 10 gateway rules, the per-user rules, the API smoke, 10 browser tests with a real sign-in, no drift, a release goes live. Three Floci differences had to be handled:

- **Signing keys from the issuer:** Floci's verifier fetches the pool's JWKS from the token issuer and accepts plain HTTP only for a *literal private IP* when `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS=true`. With the default issuer `http://localhost:4566/<pool>` every valid token failed with a silent 401 (debug log: "JWT OIDC discovery document must use HTTPS"). `compose.yaml` sets `FLOCI_HOSTNAME=127.0.0.1`, so tokens carry `iss = http://127.0.0.1:4566/<pool>`, and `cognito_issuer_base` matches it. The function compares that issuer but fetches its keys through `AWS_ENDPOINT_URL`, so it is unaffected.
- **Route matching:** Floci takes the first route created that matches, not the most specific one, so a protected `ANY /api/{proxy+}` could swallow `POST /api/auth/login`. `api.tf` lists the app's routes so they never overlap.
- **Access tokens:** Floci accepts `client_id` in place of `aud` (as AWS does), so the audience is the app client id.
