# FullStack-DevOps

🌱 **Plant Parent** — a learning project: a classic full-stack houseplant tracker (watering schedules + photo timelines), deployed to AWS-style infrastructure running **locally** on [Floci](https://floci.io).

- `frontend/` — React + Vite + TypeScript + Tailwind + shadcn/ui (served by nginx)
- `backend/` — Go + Echo REST API
- Postgres for data, S3 for photos and files
- `infra/` — Terraform: ECR → ECS (2 services) → ALB → RDS → S3 on Floci

See `docs/superpowers/specs/` for the design.
