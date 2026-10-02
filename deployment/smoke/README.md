# Deployment smoke tests

Shared by every deployment style. Each takes only the deployed base URL, so the same checks prove an EC2, ECS or EKS deployment works.

- `api-smoke.sh <base_url> <media_bucket>`: API journey through the load balancer (health, create, 2 MiB upload/download, S3 object, water, delete, S3 cleanup).
- `browser.spec.ts`: the same journey in a real browser through the UI (Playwright, Chromium).

```bash
cd deployment/smoke && npm ci && npx playwright install chromium
SMOKE_STAGE=classic-ec2 SMOKE_BASE_URL=http://localhost:8088 npm run browser
```

`SMOKE_STAGE` (`classic-ec2`, `ecs`, `eks` or `serverless`; each stage's `make smoke` sets it) tells you which deployment a recording belongs to:
- the output folders are `test-results/<stage>/` and `playwright-report/<stage>/`, and each video's folder name ends with the stage;
- every page in the recording carries a corner label such as `ecs · ECS Fargate · http://localhost:8089`;
- CI uploads it as the artifact `e2e-recording-<stage>`.
