# Serverless + Amazon Cognito — on Floci

The [serverless](../serverless/) recipe (Lambda + API Gateway + CloudFront + S3) with real sign-in: users sign in with **Amazon Cognito**, the function verifies every request's token, and every user sees only their own plants (members of the `admin` group see all). The same rules as [ecs-cognito](../ecs-cognito/), on a serverless platform.

- **Function:** [`backend-serverless-auth/`](../../../backend-serverless-auth/), a copy of `backend-auth` (token checks, per-user data, sign-in endpoints) with the Lambda entry point. The API Gateway adapter passes cookies both ways, because payload format 2.0 carries them in their own field (the refresh token is one).
- **Site:** [`frontend-auth/`](../../../frontend-auth/): a public home page; sign-in when the visitor adds or opens a plant.
- **Own emulator** on :4568 (`compose.yaml`), so it runs next to the serverless stage. App: http://plant-auth.localhost:4568 (`alice@plant.example` / `Plant-Parent-2026!`).

```bash
make up        # emulator, function, site, infrastructure, wait
make smoke     # 27 sign-in/authorization checks, API smoke as alice, browser tests with a real login
make rollout   # new function version via the live alias
make destroy
```

Everything below is the serverless recipe this stage is built on.

# serverless: Lambda + API Gateway + CloudFront + S3

The Plant Parent app with no servers to run: the Go API is an AWS Lambda function, the React app is files in S3, and CloudFront is the single public entrance. Runs locally on [Floci](https://floci.io); the Terraform is real-AWS-shaped.

The API code is its own project, [`backend-serverless/`](../../../backend-serverless/): the same routes as `backend/`, with a Lambda entry point instead of a web server. This folder does not use `backend/`.

```
                    ┌────────────── CloudFront (one hostname) ──────────────┐
 browser ──────────▶│  /api/*  ──▶ API Gateway (HTTP API) ──▶ Lambda (Go)   │──▶ RDS Postgres
                    │  other   ──▶ S3 site bucket (React build, private)    │──▶ S3 media bucket
                    └───────────────────────────────────────────────────────┘     Secrets Manager
```

## Run it

```bash
make up        # Floci (own compose file) + build function + build React + terraform apply + wait
make smoke     # shared API + browser tests through CloudFront
make rollout   # ship a new release; X-Release must change, API smoke must pass
make destroy
```

Open the URL from `terraform output app_url` (http://plant.localhost:4567). Needs Docker, Terraform ≥ 1.14, AWS CLI v2, Go, Node 22 and `zip`.

## Files

| File | Concern |
|---|---|
| `lambda.tf` | the function (`provided.al2023`), its environment, the `live` alias |
| `api.tf` | HTTP API, `AWS_PROXY` integration, route `ANY /api/{proxy+}`, permission for API Gateway to invoke the alias |
| `cdn.tf` | CloudFront: S3 origin (origin access control), API origin, `api/*` behavior, SPA routing |
| `storage.tf` | media bucket (uploads) and private site bucket (React build, uploaded as objects) |
| `iam.tf` | one execution role: logs + network interfaces, media bucket, one secret |
| `network.tf` `security.tf` `database.tf` | VPC with function subnets, RDS Postgres, the secret holding the connection string |
| `compose.yaml` | this stage's own Floci (see [FLOCI-NOTES.md](FLOCI-NOTES.md)) |

## What you learn

- **The function model.** A Go binary named `bootstrap` in a zip, run by `provided.al2023`. The first request after idle is a cold start; later ones reuse the process, so the DB pool and router are built once (`cmd/lambda/main.go`) and kept small (`MaxConns = 2`), because every concurrent instance holds its own connections.
- **Events, not sockets.** API Gateway hands the function a JSON event; `cmd/lambda/adapter.go` turns it into an `http.Request` so the unchanged Echo router can serve it. Binary uploads arrive base64-encoded.
- **Versions and aliases.** Each code or config change publishes an immutable version; API Gateway calls the `live` alias, so a release is moving that alias.
- **Secrets without ECS magic.** Lambda cannot inject a secret as an env var, so the function fetches the DB URL from Secrets Manager at cold start; the role allows exactly that one secret.
- **One origin for page and API.** CloudFront routes by path, so the browser needs no CORS. Static files come from a *private* bucket reachable only by this distribution.
- **Single-page-app routing.** `/plants/123` is not an S3 key. A CloudFront Function rewrites such paths to `/index.html`. (Locally Floci cannot run it; see the notes.)

## Compared with the other stages

| | classic-ec2 | ecs | eks | serverless |
|---|---|---|---|---|
| You run | VMs | containers on Fargate | a Kubernetes cluster | nothing; you ship a zip |
| Scaling | manual | service desired count | HPA / nodes | per request, automatic |
| Entrance | ALB | ALB | ALB → NodePort | CloudFront → API Gateway |
| Idle cost | instances | tasks | cluster + nodes | ~zero |
| Release | new AMI/instances | new task definition | new ReplicaSet | new function version + alias |
