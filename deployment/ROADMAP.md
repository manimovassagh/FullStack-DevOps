# Deployment roadmap

Where this blueprint is going, and the rules that keep it a clean repo to learn from.
Done stages are in [README.md](README.md). This file plans the next ones.

## Principles

1. **Every stage is a standalone cookbook recipe.** One folder holds everything one deployment style needs. You can read it top to bottom, copy it out of the repo and deploy it, without reading any other folder.
   **No shared Terraform:** no shared modules, and no imports or references between stages. Copying the network/database/S3 code between stages is on purpose. A recipe that depends on other files is not a recipe.
   The only shared things are outside the deploy itself: the app being deployed, the [smoke](smoke/) tests that check it, and the lint config.
2. **Never mix styles in one folder.** A new way to ship the same app (Helm, GitOps, blue/green) gets its own folder; it is not a flag on an existing one.
3. **Same app, same tests.** Every stage deploys the unchanged Plant Parent app (except where a style needs an adapter, e.g. Lambda). Every stage must pass the shared [smoke](smoke/) tests.
4. **Same interface.** Every stage has a Makefile with the same core targets, so moving between stages feels familiar.
5. **Local first, cloud-ready.** Each stage runs on Floci (or a local equivalent). Floci-only workarounds are gated (`on_floci`) and explained in `FLOCI-NOTES.md`; the real-cloud version stays in the code.
6. **Green before merge.** No stage merges without its CI job passing: deploy → healthy → idempotent plan → API + browser smoke → (rollout) → clean teardown.

## Target folder structure

```
deployment/
├── README.md                 index: every stage, what it teaches, status
├── ROADMAP.md                this file
├── smoke/                    shared tests (API script + Playwright), used by every stage
├── .tflint.hcl  .trivyignore shared lint/security config
│
├── aws/
│   ├── classic-ec2/          ✅ VMs: EC2 + ALB + UserData/systemd
│   ├── ecs/                  ✅ containers: ECS Fargate + ALB
│   ├── ecs-cloudfront/       ✅ React on S3 + CloudFront, API on ECS behind an ALB only CloudFront may use
│   ├── eks/                  ✅ Kubernetes: EKS + Kustomize + ALB
│   ├── ec2-asg/              ✅ VMs done right: Launch Template + Auto Scaling Group
│   ├── serverless/           ✅ Lambda + API Gateway + S3 + CloudFront (own Go project: /backend-serverless)
│   ├── ecs-blue-green/       ✅ ECS with weighted target groups (blue/green + canary)
│   ├── eks-helm/             ✅ same app as a Helm chart
│   ├── eks-gitops/           ✅ Argo CD pulls the manifests from git
│   ├── ecs-cognito/          ✅ ECS + Amazon Cognito sign-in (own app copies: /backend-auth, /frontend-auth)
│   ├── ecs-alb-auth/         ✅ ECS + sign-in at the ALB (authenticate-cognito), unchanged app
│   ├── serverless-gateway-auth/ ✅ serverless + Cognito, the token checked by API Gateway's JWT authorizer
│   └── beanstalk/            dropped: Floci only stores Beanstalk metadata (see phase 5)
│
├── azure/                    later: same idea, Azure services
└── gcp/                      later: same idea, Google Cloud services
```

Each stage folder looks the same inside:

```
<stage>/
├── README.md          what this style is, diagram, step table, how it compares to the others
├── FLOCI-NOTES.md     what Floci does differently and how the stage works around it
├── Makefile           the standard targets (below)
├── versions.tf  providers.tf  variables.tf  outputs.tf
├── <concern>.tf       one file per concern: network.tf, alb.tf, ecs.tf, iam.tf, security.tf …
├── scripts/           shell helpers (shellchecked in CI)
├── k8s/ | helm/ | lambda/ | templates/   only what this style needs
└── .terraform.lock.hcl                   committed
```

**Standard Makefile targets** (every stage):

| Target | Does |
|---|---|
| `up` | everything from zero to a working app |
| `deploy` | `terraform apply` |
| `wait` | block until the app is healthy |
| `check` | `terraform plan -detailed-exitcode` (idempotency) |
| `smoke` | shared API + browser tests against `app_url` |
| `rollout` | ship a new version and prove it replaced the old one (where it applies) |
| `logs` / `health` | debugging |
| `destroy` / `forget` | tear down / drop stale state after a Floci restart |

**Ports on localhost** (each stage gets its own, so stages can run side by side):

| Stage | URL |
|---|---|
| classic-ec2 | http://localhost:8088 |
| ecs | http://localhost:8089 |
| ecs-cloudfront | http://plant-cf.localhost:4571 (own Floci; ALB :8098 answers 403) |
| eks | http://localhost:8090 |
| ecs-blue-green | http://localhost:8091 (preview: 8092) |
| ec2-asg | http://localhost:8093 |
| serverless | http://plant.localhost:4567 (its own Floci, via a CloudFront alias) |
| eks-helm | http://localhost:8094 |
| eks-gitops | http://localhost:8095 |
| ecs-cognito | http://localhost:8096 |
| ecs-alb-auth | http://localhost:8097 (own Floci :4569) |
| serverless-gateway-auth | http://plant-gw.localhost:4570 (own Floci) |
| beanstalk (dropped) | – |

**CI:** one workflow file per deployment family, each its own pipeline in the Actions tab and each run only when its paths change: [`ec2.yml`](../.github/workflows/ec2.yml) (classic-ec2: VMs, native artifacts), [`containers.yml`](../.github/workflows/containers.yml) (ecs + eks: both run the same images) and [`serverless.yml`](../.github/workflows/serverless.yml). Each later family (blue/green, GitOps, Azure, GCP …) adds its own file.

## Phases

Each phase is one branch and one PR, merged only when CI is green.

### Phase 0: Restructure ✅ done

- `classic-ec2/`, `ecs/`, `eks/` and `serverless/` live under `deployment/aws/`; relative paths (`../../smoke`, `../../../frontend`, the Makefiles' `ROOT`), CI working directories and links were updated.
- Each stage still deploys from its own folder alone; nothing was shared or extracted.
- The port table is in this file.

### Phase 1: `serverless/` ✅ done

Lambda (Go, `provided.al2023`) + API Gateway HTTP API (v2) + React build in a private S3 bucket + CloudFront in front (one hostname; `/api/*` to the API, everything else to S3).
- **Teaches:** no servers or clusters, the function packaging and handler model, cold starts, versions and aliases, per-function IAM, a function in a VPC talking to RDS, secrets read at cold start, CloudFront origins and behaviors, a private static site.
- **Own project, not mixed:** the function code is [`backend-serverless/`](../backend-serverless/), a separate Go module with its own copy of the handlers (same routes as `backend/`). `backend/` is untouched.
- **Own workflow:** [`.github/workflows/serverless.yml`](../.github/workflows/serverless.yml), a top-level pipeline with a node for each part: Lambda backend tests, frontend build, IaC checks, function build, then deploy + verify (infrastructure, **frontend → S3**, smoke tests, rollout). Terraform manages the infrastructure; `make site` uploads the React build to the site bucket.
- **Own Floci:** it runs on a dated nightly (port 4567, `deployment/aws/serverless/compose.yaml`), because Floci 2.1.0 does not forward POST/PUT/DELETE through CloudFront. Details in its FLOCI-NOTES.md.
- **Rollout:** a new release label changes the function's environment, publishes a version and moves the `live` alias; the test checks the `X-Release` header.

### Phase 2: `aws/ecs-blue-green/` ✅ done

- Two environments (blue, green) × two tiers, each with its own ECS services and target groups, behind one ALB. The public listener **forwards with weights**; a second **preview listener** always goes to green so a candidate is smoke-tested before any user sees it.
- **Make targets:** `release TAG=…`, `preview`, `canary PCT=10`, `promote`, `rollback`, `finalize`, `abort`, `sample`. A small state machine (`scripts/release.sh`) edits `release.auto.tfvars.json` and refuses nonsense transitions.
- **Test:** `make rollout` walks release → preview → canary → promote → rollback → promote → finalize and asserts after each step where the traffic goes (it counts requests in each environment's backend logs).
- **Not done:** CodeDeploy's ECS blue/green deployment type (Floci lists `codedeploy`, untested here). The weights are moved explicitly so each step is visible.

### Phase 3: how Kubernetes teams ship ✅ done (`eks-helm`, `eks-gitops`)

- **eks-helm ✅:** the same app as a Helm chart (`helm/plant/`), delivered with `helm upgrade --install --wait`. The point is the comparison with eks's Kustomize: templating vs patching, values files, numbered releases, `helm rollback`. `make rollout` upgrades, rolls back and upgrades again, with an API smoke test after each.
- **eks-gitops ✅:** Argo CD (core install) runs in the cluster and watches a git repo (a local bare repo served by a `git daemon` container, so it works offline); a release is a commit that bumps the image tag, rollback is `git revert`, and Argo CD's self-heal reverts manual changes. `make rollout` asserts all three.
- Each is a full recipe: its own copy of the EKS platform Terraform (VPC, cluster, RDS, S3, ALB) plus its own delivery method. Neither one references or edits `aws/eks/`.

### Phase 4: `aws/ec2-asg/`, VMs the production way ✅ done

- A Launch Template plus an Auto Scaling Group per tier behind the ALB (the classic-ec2 recipe with groups instead of hand-made instances). Floci's reconciler really launches, registers and replaces the instances.
- **Self-healing and rolling replacement:** `make rollout` creates a new launch-template version (instances unchanged), rolls every instance (`scripts/roll.sh`, since Floci has no instance refresh), then kills one and watches the group heal.

### Phase 5: `aws/beanstalk/`, PaaS (dropped)

Floci's Elastic Beanstalk is stored state only: `CreateEnvironment` returns an immediately `Ready` environment and nothing runs. By this roadmap's own rule (a stage must really deploy and pass the shared smoke tests) it is dropped; revisit if Floci starts running environments.

### Phase 6: Cross-cutting upgrades (applied to every stage, not new stages)

- **Remote state:** each stage can switch its own `backend "s3"` on. The bucket comes from a documented one-time CLI step, not from another stage's Terraform.
- **Observability:** CloudWatch log groups, metrics and alarms per stage. Later, an OpenTelemetry collector.
- **Environments:** dev/prod from the same stage code (tfvars per environment), without copying folders.

### Google Cloud and Azure: one stage each

AWS is the popular one, so the other two clouds get only the most common container deployment, not the full range. Both run on Floci's sibling emulators ([floci-gcp](https://github.com/floci-io/floci-gcp), [floci-az](https://github.com/floci-io/floci-az)), each with its own compose file in the stage.

- **`gcp/cloud-run/` ✅:** Cloud Run + Cloud SQL + Cloud Storage, behind an nginx gateway. The API is `backend-gcp/`, a copy of the backend with Cloud Storage as photo storage (the emulator's S3-style upload is broken, so the unchanged backend can't be used). Workflow `gcp-cloud-run.yml`.
- **`azure/container-apps/` ✅:** Container Apps + PostgreSQL Flexible Server, with the repo's backend and frontend unchanged and an S3-compatible object store in the stage (Azure Blob has no S3 interface). Terraform runs in a container that trusts the emulator's TLS certificate. Workflow `azure-container-apps.yml`.

### Authentication and authorization: `aws/ecs-cognito/` ✅

The ecs recipe plus Amazon Cognito (user pool, app client, `admin` group, demo users). The app gets its own copies, `backend-auth/` (JWT verification against the pool's JWKS, owner-scoped queries, sign-in endpoints) and `frontend-auth/` (login page, in-memory access token, HttpOnly refresh cookie); the shared `backend/` and `frontend/` are untouched. Workflow `ecs-cognito.yml`. The shared smoke tests got two optional hooks (`SMOKE_AUTH_TOKEN`, `SMOKE_LOGIN_USER`), and the Playwright suite was reorganised into page objects, fixtures and one spec per feature.

### Authentication at the edge: `aws/ecs-alb-auth/` ✅

The ecs recipe with sign-in moved out of the app: the ALB listener runs `authenticate-cognito` before it forwards. Pages without a session are redirected to the Cognito hosted login, `/api/*` calls get 401, and after sign-in the ALB keeps the session in its own cookie. The app is the unchanged `backend/` and `frontend/`. Compare it with `ecs-cognito`, where the Go API checks every token itself. Runs on its own nightly Floci (2.1.0 has no ALB authentication); on real AWS the listener must be HTTPS. Workflow `ecs-alb-auth.yml`. The shared smoke tests got two more optional hooks (`SMOKE_COOKIE_JAR`, `SMOKE_STORAGE_STATE`) and `hosted-login.mjs`.

### Authentication at the gateway: `aws/serverless-gateway-auth/` ✅

The serverless-cognito recipe with an API Gateway JWT authorizer: `GET /api/health` and `POST /api/auth/{proxy+}` stay open, everything else needs a valid Cognito access token at the gateway, so a bad token gets 401 without invoking the function. Same app (`backend-serverless-auth`, `frontend-auth`), which still checks the token as defence in depth. Workflow `serverless-gateway-auth.yml`.

### The common SPA layout: `aws/ecs-cloudfront/` ✅

The React build in a private S3 bucket and the API on ECS, both behind one CloudFront distribution (`/*` → S3, cached; `/api/*` → ALB, never cached). The ALB's default action is a fixed 403; it forwards only requests with the secret header CloudFront adds (and on real AWS only from CloudFront's managed prefix list). No frontend container. Own nightly Floci (:4571) because 2.1.0 drops POST/PUT/DELETE through CloudFront. Workflow `ecs-cloudfront.yml`.
