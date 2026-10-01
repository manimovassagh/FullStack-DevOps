# Deployment smoke tests

Shared by every deployment style. Each takes only the deployed base URL, so the same checks prove an EC2, ECS or EKS deployment works.

- `api-smoke.sh <base_url> <media_bucket>`: API journey through the load balancer (health, create, 2 MiB upload/download, S3 object, water, delete, S3 cleanup).
- `browser.spec.ts`: the same journey in a real browser through the UI (Playwright, Chromium).

```bash
cd deployment/smoke && npm ci && npx playwright install chromium
SMOKE_BASE_URL=http://localhost:8088 npm run browser
```
