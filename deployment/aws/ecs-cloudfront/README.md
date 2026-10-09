# ECS API + React on S3 behind CloudFront — on Floci

```
browser ─► CloudFront plant-cf.localhost:4571 ─┬─ /*      ─► S3 site bucket (private, origin access control) ← React build, cached
                                               └─ /api/* ─► ALB ──[X-Origin-Verify = secret?]──► ECS service backend (Fargate)
                                                             └── anything else (or no secret) → 403
 backend task ─► RDS Postgres (DATABASE_URL from Secrets Manager) ─► S3 plant-ecs-cf-media
```

The most common way to run a single-page app with a container API on AWS: the static frontend is files in S3 served by CloudFront, and only the API runs on containers. Compared with [ecs](../ecs/) there is no frontend container, no nginx and no second ECS service.

## Run it

    cd deployment/aws/ecs-cloudfront
    make up                  # own Floci (:4571) → backend image → ECR → terraform apply → React build → S3 → wait
    make smoke               # the ALB refuses everyone but CloudFront; API + browser smoke tests through CloudFront
    open http://plant-cf.localhost:4571
    make destroy && docker compose down

`make check` proves the deployment is idempotent. `make rollout` ships a new backend task-definition revision. A frontend release is `make frontend site`: upload the new build and invalidate the CloudFront cache, no container involved.

## What each file teaches

| File | AWS concept |
|---|---|
| cdn.tf | a distribution with two origins (S3 + the ALB), cache behaviours (`/*` cached, `api/*` never cached and forwarding every header and cookie), origin access control, a CloudFront Function for SPA routing |
| storage.tf | a private site bucket that only this distribution may read (bucket policy with `AWS:SourceArn`) |
| alb.tf | the ALB as a private origin: default action `fixed-response 403`, a listener rule that forwards only `/api/*` with the secret `X-Origin-Verify` header CloudFront adds |
| security.tf | on real AWS the ALB accepts traffic only from CloudFront's managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`) |
| ecs.tf, ecr.tf | one service, one image: the frontend is not a container any more |
| scripts/origin-lock.sh | proves the lock: the same call works through CloudFront and gets 403 at the ALB |

## Compared with ecs

| | ecs | ecs-cloudfront |
|---|---|---|
| frontend | nginx container (ECS service) | files in S3, cached at CloudFront's edge |
| public entrance | the ALB | CloudFront; the ALB only answers CloudFront |
| frontend release | build and roll an image | `aws s3 sync` + cache invalidation |
| ECS services | 2 | 1 |
| CORS | none (one host) | none (one host: CloudFront routes `/api/*`) |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md). Shared tests: [smoke](../../smoke/).
