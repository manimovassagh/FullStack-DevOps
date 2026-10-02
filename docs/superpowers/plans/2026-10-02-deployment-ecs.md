# Deployment Stage — ECS on Floci — Implementation Plan

> Executed inline (superpowers:executing-plans). Per the user's standing preference, all Terraform is written first, then applied; only real apply failures are debugged.

**Goal:** `deployment/ecs/` deploys Plant Parent to ECS Fargate behind an ALB on Floci, verified by the shared smoke tests locally and in GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-10-02-deployment-ecs-design.md`

## Global Constraints

- Floci pinned to `floci/floci:2.1.0`; local only; credentials `test`/`test`; region `us-east-1`.
- Terraform only, plain resources, local state; `.terraform.lock.hcl` committed.
- Resource prefix `plant-ecs`; VPC `10.1.0.0/16`; ALB listener 81 → `localhost:8089`.
- No app code changes besides the two new Dockerfiles (+ `.dockerignore`).
- classic-ec2 must keep working (shared docker-compose).

## Review Focus

1. Re-apply with the same image tag is a no-op (`terraform plan -detailed-exitcode` = 0).
2. A new image tag rolls the service to a new task-definition revision without breaking health.
3. SPA deep links through the ALB return the app (nginx fallback in the frontend image).
4. 2 MiB upload through the ALB to the backend task works (smoke).
5. `make destroy` with leftover S3 objects does not hang (empty buckets first, as in classic-ec2).

## Tasks

### Task 1: Container images
Files: `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/nginx.conf`.
Verify: `docker build` both; `docker run` frontend → `GET /plants/x` = 200 with `<div id="root">`; backend container starts and fails fast with "missing required env vars" when run without env (proves the binary runs).

### Task 2: Terraform stage
Files: `deployment/ecs/{versions,providers,variables,network,security,ecr,storage,iam,database,ecs,alb,outputs}.tf`, `Makefile`, `README.md`, `FLOCI-NOTES.md`; `docker-compose.yml` (ECS docker network env, `8089:81`).
Verify: `terraform init`, `fmt -check`, `validate`; `make smoke` against `localhost:8089` fails before deploy (RED).

### Task 3: Apply and debug
Verify: `make apply && make wait && make smoke` → `SMOKE PASSED` + Playwright passed; `terraform plan -detailed-exitcode` = 0; roll a new tag (`make apply IMAGE_TAG=<new>`) → new revision, healthy; `make destroy` clean; root `make test` passes; classic-ec2 still applies (spot check `terraform validate`).

### Task 4: CI and merge
Files: `.github/workflows/deploy-ecs.yml`, `deployment/README.md` (stage table).
Verify: workflow green on the branch; PR merged to main.
