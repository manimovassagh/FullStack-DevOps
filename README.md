# FullStack-DevOps

🌱 **Plant Parent** — a learning project: a classic full-stack houseplant tracker (watering schedules + photo timelines), deployed to AWS-style infrastructure running **locally** on [Floci](https://floci.io).

- `frontend/` — React + Vite + TypeScript + Tailwind + shadcn/ui (served by nginx)
- `backend/` — Go + Echo REST API
- Postgres for data, S3 for photos and files
- `infra/` — Terraform: ECR → ECS (2 services) → ALB → RDS → S3 on Floci

See `docs/superpowers/specs/` for the design.

## Run it locally

Prereqs: Docker, Go 1.26+, Node 22+, AWS CLI.

```bash
make up         # Postgres :5432 + Floci :4566, creates the S3 bucket "plant-media"
make backend    # Go API on http://localhost:8080  (terminal 1)
make frontend   # Vite on http://localhost:5173      (terminal 2)
make test       # Go (unit + Postgres/Floci integration) + Vitest
```

Peek into Floci's S3:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url http://localhost:4566 --region us-east-1 s3 ls s3://plant-media --recursive
```
