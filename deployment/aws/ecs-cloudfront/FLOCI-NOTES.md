# Floci notes for ecs-cloudfront

## Its own emulator, a dated nightly

`compose.yaml` runs `floci/floci:nightly-10012026` on :4571. In 2.1.0 a POST, PUT or DELETE sent through a CloudFront distribution gets an empty `405` (see the serverless stage), and the API sits behind CloudFront here. The ALB listener is also published on :8098, only so `scripts/origin-lock.sh` can show that calling it directly is refused.

## CloudFront on Floci (same workarounds as the serverless stages)

- **App URL:** a distribution alias, `plant-cf.localhost:4571` (`*.localhost` resolves to 127.0.0.1; Floci routes by the Host header). On AWS: the `*.cloudfront.net` domain.
- **The ALB origin is `localhost` on the listener port.** Floci's CloudFront and its ALB listeners run in the same process, and CloudFront refuses origins that resolve to local addresses unless allow-listed (`FLOCI_SERVICES_CLOUDFRONT_ALLOWED_PRIVATE_ORIGIN_HOSTS: localhost`). On AWS the origin is the ALB's DNS name.
- **CloudFront Functions are stored, not run.** Locally a distribution-wide error page turns S3's 403/404 into `index.html`, which also rewrites the API's own 404s. `make smoke` sets `SMOKE_ALLOW_SPA_FALLBACK=1` for that; on AWS the function does the SPA routing and real 404s come through.

## The ALB lock

Floci implements `fixed-response` actions and `http-header` listener conditions (both present in the nightly binary). The managed prefix list for CloudFront does not exist on Floci, so with `on_floci` the ALB security group is open and only the secret header locks it.

## Not verified yet

Written before the first live run (fix forward). After `make up smoke`, record here whether the custom header reaches the ALB rule and whether OAC-signed reads of the private bucket work.
