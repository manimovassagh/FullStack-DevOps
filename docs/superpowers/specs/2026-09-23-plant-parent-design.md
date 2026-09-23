# 🌱 Plant Parent — Design

**Date:** 2026-09-23
**Goal:** Learn to build a classic full-stack app (React frontend, Go backend, Postgres, S3 file storage) and deploy it to AWS-style infrastructure running locally on [Floci](https://floci.io) (AWS emulator, `localhost:4566`).

**The app:** track your houseplants. Each plant has a watering schedule ("Monstera is thirsty in 2 days"), a photo growth timeline, and files such as care-guide PDFs.

## Scope

In: plant CRUD, watering schedule + "water now", media (photos + any files) per plant with captions, a timeline that mixes photos/files/waterings, a local dev environment, Docker images, Terraform deployment to Floci (ECR, ECS, ALB, RDS, S3, Secrets Manager, CloudWatch Logs).

Stage 5: rebuild the identical infrastructure with AWS CDK (TypeScript) in `infra-cdk/` to compare IaC tools.

Out (candidate later stages): auth (Cognito), Lambda thumbnail generation on S3 upload, EventBridge Scheduler + SNS watering notifications, presigned-URL uploads, CI/CD, real-AWS deployment.

## Architecture

```
Browser ─► ALB :80 (Floci)
            ├─ /api/*  ─► ECS service "backend"  (Go/Echo, port 8080) ─► RDS Postgres
            │                                                          └► S3 bucket "plant-media"
            └─ /*      ─► ECS service "frontend" (nginx serving React build, port 80)
Images live in ECR repos: plant-backend, plant-frontend
```

The app knows nothing about Floci. All environment-specific config comes from environment variables:

| Var | Local dev | On Floci ECS |
|---|---|---|
| `PORT` | 8080 | 8080 |
| `DATABASE_URL` | `postgres://plant:plant@localhost:5432/plant?sslmode=disable` | built from RDS endpoint + Secrets Manager |
| `S3_BUCKET` | `plant-media` | `plant-media` |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | Floci address reachable from containers |
| `AWS_REGION` | `us-east-1` | `us-east-1` |
| `MAX_UPLOAD_BYTES` | 10485760 | 10485760 |

The frontend always calls relative `/api/...` URLs. Vite's dev proxy does the routing locally; the ALB does it when deployed.

## Repo layout

```
FullStack-DevOps/
├── frontend/            React + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui + react-router
├── backend/             Go + Echo v4
│   ├── cmd/server/          main.go: config, wiring, graceful shutdown
│   ├── internal/config/
│   ├── internal/store/      Postgres (pgx/v5) + embedded SQL migrations
│   ├── internal/storage/    FileStorage interface + S3 implementation (aws-sdk-go-v2)
│   └── internal/handler/    Echo HTTP handlers
├── dev/                 local-only helper files (postgres init SQL)
├── infra/               Terraform (stage 4)
├── docker-compose.yml   postgres:16-alpine + floci/floci
├── Makefile             up, down, bucket, backend, frontend, test
└── docs/
```

## Data model

```sql
CREATE TABLE plants (
  id                UUID PRIMARY KEY,
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  species           TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT '',          -- "Living room window"
  notes             TEXT NOT NULL DEFAULT '',
  water_every_days  INT  NOT NULL CHECK (water_every_days BETWEEN 1 AND 365),
  last_watered_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE waterings (
  id          UUID PRIMARY KEY,
  plant_id    UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  watered_on  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE media (
  id            UUID PRIMARY KEY,
  plant_id      UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  s3_key        TEXT NOT NULL,     -- plants/<plant_id>/<media_id>
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Derived fields (computed in SQL, never stored):
- `next_water_on = last_watered_on + water_every_days`
- `days_until_water = next_water_on - CURRENT_DATE` (≤ 0 means thirsty now)
- `cover_media_id` = the newest `media` row whose content type is `image/png|jpeg|gif|webp`

Migrations are embedded in the binary (`embed.FS`) and applied at startup inside a Postgres advisory lock (so two ECS tasks starting together don't race), tracked in `schema_migrations`.

## API

All JSON; errors are `{"error": "<message>"}`.

| Method | Path | Success | Notes |
|---|---|---|---|
| GET | `/api/health` | 200 `{"status":"ok"}` | pings DB with a 2s timeout; 503 if it fails |
| GET | `/api/plants` | 200 `[PlantSummary]` | thirstiest first (`next_water_on` asc, then name) |
| POST | `/api/plants` | 201 `Plant` | `{name, species?, location?, notes?, water_every_days, last_watered_on?}` |
| GET | `/api/plants/:id` | 200 `PlantDetail` | plant + `media[]` + `waterings[]` (newest first) |
| PATCH | `/api/plants/:id` | 200 `Plant` | partial update of any editable field |
| DELETE | `/api/plants/:id` | 204 | deletes S3 objects first, then the row (cascade) |
| POST | `/api/plants/:id/water` | 200 `Plant` | body optional `{watered_on?}` (default today); inserts a watering, sets `last_watered_on` |
| POST | `/api/plants/:id/media` | 201 `Media` | multipart `file` + optional `caption`; 413 if > MAX_UPLOAD_BYTES |
| GET | `/api/media/:id` | 200 stream | `inline` only for png/jpeg/gif/webp, everything else `attachment`; `X-Content-Type-Options: nosniff` |
| DELETE | `/api/media/:id` | 204 | S3 object first, then the row |

`Plant` = all columns + `next_water_on` + `days_until_water`. `PlantSummary` = `Plant` + `cover_media_id` (nullable) + `media_count`.

Validation: name 1–100 chars (trimmed), `water_every_days` 1–365, dates `YYYY-MM-DD` and not in the future for waterings.

**Upload consistency:** PutObject to S3 first, then INSERT the row; if the INSERT fails, DeleteObject (best effort, logged). **Deletes:** S3 first, then the DB. An orphaned S3 object is acceptable; a DB row pointing at a missing object is not.

## Frontend

Tailwind CSS v4 + shadcn/ui components (Button, Card, Dialog, Input, Label, Textarea, Badge, Sonner toasts), lucide-react icons, and a soft green "greenhouse" theme with light and dark mode.

Routes (react-router):
- `/` **Garden**: a "Thirsty" strip at the top (plants with `days_until_water ≤ 0`), then a responsive grid of plant cards showing the cover photo (or a leafy placeholder), name, species, and a water badge ("💧 today", "in 3d", "2d overdue" in red). Each card has a one-click **Water** button. An **Add plant** button opens a dialog form.
- `/plants/:id` **Plant page**: header with name, species, location, schedule, **Water now** and **Edit**/**Delete** actions; an upload dropzone (with caption); a **timeline** merging media (photo thumbnails, file chips) and watering events, sorted newest first. Clicking a photo opens it full-size in a dialog.

All data access goes through one typed `api.ts` module (`fetch`). Errors are shown as toasts.

## Local development (stage 3)

`docker compose up` starts Postgres (5432, plus a `plant_test` database for integration tests) and Floci (4566). `make bucket` creates the S3 bucket in Floci. The backend runs with `go run ./cmd/server`; the frontend with `npm run dev` (proxy `/api` → `:8080`).

## Deployment to Floci (stage 4 Terraform, then stage 5 AWS CDK — same infra, built together with the user)

The Terraform AWS provider is configured with `endpoints { ... = "http://localhost:4566" }`, test credentials, `skip_credentials_validation`, `skip_requesting_account_id`, `s3_use_path_style`.

Resources: VPC + subnets + security groups; ECR repos (images pushed with `docker push`); RDS Postgres; Secrets Manager secret for the DB password; S3 bucket; CloudWatch log groups; IAM task execution role; ECS cluster; 2 task definitions + 2 services; ALB + listener :80 + 2 target groups (backend health check `/api/health`) + a path rule `/api/*` → backend.

**Known risks to probe first:** (1) Floci lists ELB v2 as "in-process", so it may store the config without forwarding HTTP. The fallback is to reach the ECS containers via their Docker-mapped ports. (2) Which hostname ECS task containers use to reach Floci (S3) and the RDS container.

## Testing

- Backend: handler unit tests with in-memory fakes (`httptest`); store integration tests against the compose `plant_test` DB (skipped if `TEST_DATABASE_URL` is unset); an S3 round-trip test against Floci (skipped if `AWS_ENDPOINT_URL` is unset).
- Frontend: Vitest + React Testing Library for `api.ts`, the water-badge logic, and key components.
- Deployment: `make smoke` curls the ALB (health → create plant → upload photo → download → water → delete).
