# FullStack-DevOps

A learning project: a classic full-stack to-do app with file attachments, deployed to AWS-style infrastructure running **locally** on [Floci](https://floci.io).

- `frontend/` — React + Vite + TypeScript (served by nginx)
- `backend/` — Go + Echo REST API
- Postgres for data, S3 for attachments
- `infra/` — Terraform: ECR → ECS (2 services) → ALB → RDS → S3 on Floci

See `docs/superpowers/specs/` for the design.
