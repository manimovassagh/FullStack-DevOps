# Deployment Stage — ECS (Fargate) on Floci — Design

**Date:** 2026-10-02
**Goal:** Deploy Plant Parent as containers on ECS Fargate behind an ALB, with Terraform, entirely locally on Floci 2.1.0, and verify it with the shared smoke tests in GitHub Actions. Second stage of the `deployment/` blueprint (after `classic-ec2`).

## Architecture

```
Browser ─► ALB :8089 (public subnets)
             ├─ /api/* ─► TG backend  :8080 (target_type ip) ◄─ ECS service "backend"  (Fargate, 1 task)
             └─ /*     ─► TG frontend :80   (target_type ip) ◄─ ECS service "frontend" (Fargate, 1 task)
 private app subnets: tasks (awsvpc)       private db subnets: RDS Postgres 16
 ECR: plant-ecs-backend, plant-ecs-frontend   S3: plant-ecs-media   Secrets Manager: plant-ecs/database-url
```

## Decisions

- **Images.** New `backend/Dockerfile` (multi-stage Go 1.26 → `gcr.io/distroless/static-debian12:nonroot`, port 8080) and `frontend/Dockerfile` (Node 22 build → `nginx:1.27-alpine` serving `dist` with SPA fallback, port 80). No other app changes. Both are reused by later stages.
- **Delivery.** `make images` builds both images, tags them with the git short SHA (plus `-dirty` for uncommitted changes) and pushes to ECR on Floci (`000000000000.dkr.ecr.us-east-1.localhost:4566/<repo>`). ECR repos are created by Terraform first (`make apply` = targeted apply of the ECR repos → push → full apply). Task definitions reference the tag via `var.image_tag`; a new tag gives a new task-definition revision and the service rolls.
- **Network.** Own VPC `10.1.0.0/16` (2 AZs; public, app, db subnets; IGW, NAT, route tables), same layout as classic-ec2 so each stage stays self-contained. Security groups: alb (listener port from anywhere) → frontend:80 / backend:8080 → db:5432.
- **ECS.** Cluster `plant-ecs` with Container Insights setting; two Fargate task definitions (`awsvpc`, 256 CPU / 512 MiB) and two services (`desired_count = 1`, `load_balancer` block, private app subnets, `assign_public_ip = false`).
- **IAM.** Execution role: `AmazonECSTaskExecutionRolePolicy`-equivalent inline policy (ECR pull, logs) + `secretsmanager:GetSecretValue` on the DB secret. Backend task role: S3 Get/Put/Delete on media objects, ListBucket on the bucket. Frontend has no task role.
- **Config.** Backend environment: `PORT=8080`, `S3_BUCKET`, `AWS_REGION`; `DATABASE_URL` comes from `secrets.valueFrom` (one secret holding the full URL). Floci injects `AWS_ENDPOINT_URL` and credentials into task containers; on real AWS the task role supplies credentials and the endpoint is unset.
- **Logs.** `awslogs` log configuration + CloudWatch log groups (7-day retention), as on real AWS. Floci keeps output in the Docker container instead (documented).
- **ALB.** Listener port 81 inside Floci, published by docker-compose as `localhost:8089`, so classic-ec2 (8088) and ecs can run side by side. Target groups `target_type = "ip"`, health checks `/` and `/api/health`.
- **Floci settings** (docker-compose): `FLOCI_SERVICES_ECS_DOCKER_NETWORK=fullstack-devops_default` so task containers share Floci's network (ALB and RDS proxy reachable).

## Verification (done criteria)

- `terraform fmt -check` / `validate` pass; `make apply` from clean Floci succeeds; both target groups `healthy`.
- `make smoke` (shared `deployment/smoke`: API script + Playwright browser test) passes against `http://localhost:8089`.
- `terraform plan -detailed-exitcode` exits 0 after apply.
- Rolling a new image tag creates a new task-definition revision and the service stays healthy.
- `.github/workflows/deploy-ecs.yml` runs apply → wait → plan check → smoke → destroy and is green before merging to main.
- `make destroy` leaves no ECS task or RDS containers; root `make test` still passes.

## Out of scope

Autoscaling, Service Connect / Cloud Map, HTTPS, blue/green (CodeDeploy), multiple tasks per service. Candidates for follow-ups.
