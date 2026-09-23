# Todo + Attachments on Floci — Design

**Date:** 2026-09-23
**Goal:** Learn to build a classic full-stack app (React frontend, Go backend, Postgres, file storage) and deploy it to AWS-style infrastructure running locally on [Floci](https://floci.io) (AWS emulator, `localhost:4566`).

## Scope

In: to-do CRUD, file attachments per to-do (images get thumbnails), local dev environment, Docker images, Terraform deployment to Floci (ECR, ECS, ALB, RDS, S3, Secrets Manager, CloudWatch Logs).

Out (possible later stages): authentication, Lambda variant, presigned-URL uploads, CI/CD, real-AWS deployment.

## Architecture

```
Browser ─► ALB :80 (Floci)
            ├─ /api/*  ─► ECS service "backend"  (Go/Echo, port 8080) ─► RDS Postgres
            │                                                          └► S3 bucket "todo-attachments"
            └─ /*      ─► ECS service "frontend" (nginx serving React build, port 80)
Images live in ECR repos: todo-backend, todo-frontend
```

The app knows nothing about Floci. All environment-specific config comes from environment variables:

| Var | Local dev | On Floci ECS |
|---|---|---|
| `PORT` | 8080 | 8080 |
| `DATABASE_URL` | `postgres://todo:todo@localhost:5432/todo?sslmode=disable` | built from RDS endpoint + Secrets Manager |
| `S3_BUCKET` | `todo-attachments` | `todo-attachments` |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | Floci address reachable from containers |
| `AWS_REGION` | `us-east-1` | `us-east-1` |
| `MAX_UPLOAD_BYTES` | 10485760 | 10485760 |

The frontend always calls relative `/api/...` URLs. Vite's dev proxy does the routing locally; the ALB does it when deployed.

## Repo layout

```
FullStack-DevOps/
├── frontend/            React 18 + Vite + TypeScript; Dockerfile (node build → nginx:alpine)
├── backend/             Go + Echo v4; Dockerfile (multi-stage → distroless/alpine)
│   ├── cmd/server/      main.go: config, wiring
│   ├── internal/config/
│   ├── internal/store/      Postgres (pgx/v5) + embedded SQL migrations
│   ├── internal/storage/    FileStorage interface + S3 implementation (aws-sdk-go-v2)
│   └── internal/handler/    Echo HTTP handlers
├── infra/               Terraform (AWS provider pointed at Floci endpoints)
├── docker-compose.yml   postgres:16-alpine + floci/floci
├── Makefile             dev shortcuts (up, down, backend, frontend, test, deploy)
└── docs/
```

## Data model

```sql
CREATE TABLE todos (
  id          UUID PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes       TEXT NOT NULL DEFAULT '',
  done        BOOLEAN NOT NULL DEFAULT false,
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
  id            UUID PRIMARY KEY,
  todo_id       UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  s3_key        TEXT NOT NULL,     -- todos/<todo_id>/<attachment_id>
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_todo_id_idx ON attachments(todo_id);
```

Migrations are embedded in the binary (`embed.FS`) and applied at startup, tracked in a `schema_migrations` table.

## API

All JSON; errors are `{"error": "<message>"}`.

| Method | Path | Success | Notes |
|---|---|---|---|
| GET | `/api/health` | 200 `{"status":"ok"}` | pings DB with a 2s timeout; 503 if it fails |
| GET | `/api/todos` | 200 `[Todo]` | newest first; each Todo includes `attachments: [Attachment]` |
| POST | `/api/todos` | 201 `Todo` | body `{title, notes?, due_date?}`; 400 on invalid title |
| PATCH | `/api/todos/:id` | 200 `Todo` | partial update of title/notes/done/due_date; 404 if missing |
| DELETE | `/api/todos/:id` | 204 | deletes S3 objects, then the row (cascade removes attachment rows) |
| POST | `/api/todos/:id/attachments` | 201 `Attachment` | multipart field `file`; 413 if > MAX_UPLOAD_BYTES; 404 if to-do missing |
| GET | `/api/attachments/:id` | 200 file stream | sets `Content-Type` and `Content-Disposition` (inline for images) |
| DELETE | `/api/attachments/:id` | 204 | deletes S3 object, then the row |

**Upload consistency:** PutObject to S3 first, then INSERT the row. If the INSERT fails, DeleteObject (best effort, logged). **Delete:** S3 first, then the DB. An orphaned S3 object is acceptable; a DB row pointing at a missing object is not.

## Frontend

A single page. Components: `TodoForm` (create), `TodoList` → `TodoItem` (toggle done, inline edit, delete, due date), `AttachmentList` (thumbnail grid for `image/*`, file chip with download link otherwise, delete button), `AttachmentUpload` (file input + drag-and-drop, shows upload progress/errors). API access goes through a single typed `api.ts` module using `fetch`. Plain CSS modules, no UI library. State is local React state refreshed after each mutation, with no global store.

## Local development (stage 3)

`docker compose up` starts Postgres (5432) and Floci (4566). A one-shot `awscli` command (Makefile `make bucket`) creates the S3 bucket in Floci. The backend runs with `go run ./cmd/server`; the frontend with `npm run dev` (proxy `/api` → `:8080`).

## Deployment to Floci (stage 4, Terraform)

The Terraform AWS provider is configured with `endpoints { ... = "http://localhost:4566" }`, test credentials, and `skip_credentials_validation` / `skip_requesting_account_id` / `s3_use_path_style`.

Resources: VPC + 2 subnets + security groups; ECR repos (images pushed with `docker push`); RDS Postgres instance; Secrets Manager secret for DB password; S3 bucket; CloudWatch log groups; IAM task execution role; ECS cluster; 2 task definitions + 2 services; ALB + listener :80 + 2 target groups (backend health check `/api/health`) + a path rule `/api/*` → backend.

**Known risk:** Floci lists ELB v2 as "in-process". It may accept the configuration without actually forwarding HTTP. The first deployment step verifies this. Fallback: reach the ECS containers via their Docker-mapped ports and document the gap. The ECS→RDS/S3 networking (which hostname containers use to reach Floci and the RDS container) must also be verified before writing the full Terraform.

## Testing

- Backend: unit tests for handlers using fake `Store`/`FileStorage` implementations (`httptest`); integration tests for `store` against the docker-compose Postgres (skipped if `DATABASE_URL` is unset).
- Frontend: Vitest + React Testing Library for `api.ts` and key components.
- Deployment: a `make smoke` script that curls the ALB — health, create a to-do, upload a file, download it, delete it.
