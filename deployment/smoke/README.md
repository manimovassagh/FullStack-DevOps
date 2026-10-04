# Deployment smoke tests

Shared by every deployment style. Each takes only the deployed base URL, so the same checks prove an EC2, ECS, EKS, Cloud Run or Container Apps deployment works.

- `api-smoke.sh <base_url> <media_bucket>`: API journey through the load balancer (health, create, 2 MiB upload/download, object in the bucket, water, delete, bucket cleanup).
- `tests/`: the same app in a real browser (Playwright, Chromium), organised like any other test project:

```
tests/
├── fixtures.ts            test.extend(...): stamps the stage into the video, signs in when the stage has a login,
│                          and a `plant` fixture that creates a plant and deletes it afterwards
├── pages/                 page objects: LoginPage, GardenPage, PlantPage (selectors live here, not in the tests)
├── support/               stage labels (stage.ts) and test data (assets.ts)
├── plants/                one spec per feature: create-plant, water-plant, photos, deep-link, delete-plant
└── auth/sign-in.spec.ts   wrong password, sign-in/out, session survives a reload (skipped when the stage has no login)
```

```bash
cd deployment/smoke && npm ci && npx playwright install chromium
SMOKE_STAGE=classic-ec2 SMOKE_BASE_URL=http://localhost:8088 npm run browser
```

Optional settings:

| Variable | Does |
|---|---|
| `SMOKE_AUTH_TOKEN` | `api-smoke.sh` sends it as `Authorization: Bearer …` (stages with sign-in) |
| `SMOKE_LOGIN_USER`, `SMOKE_LOGIN_PASSWORD` | the browser tests sign in through the login form first |
| `SMOKE_VIDEO=off` | no video (it needs Playwright's ffmpeg download) |
| `SMOKE_BROWSER_CHANNEL=chrome` | use the Chrome installed on this machine instead of Playwright's download |

`SMOKE_STAGE` (each stage's `make smoke` sets it) tells you which deployment a recording belongs to:
- the output folders are `test-results/<stage>/` and `playwright-report/<stage>/`, and each video's folder name ends with the stage;
- every page in the recording carries a corner label such as `ecs · ECS Fargate · http://localhost:8089`;
- CI uploads it as the artifact `e2e-recording-<stage>`.
