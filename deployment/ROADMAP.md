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
│   ├── eks/                  ✅ Kubernetes: EKS + Kustomize + ALB
│   ├── ec2-asg/              VMs done right: Launch Template + Auto Scaling Group
│   ├── serverless/           ✅ Lambda + API Gateway + S3 + CloudFront (own Go project: /backend-serverless)
│   ├── ecs-blue-green/       ECS with weighted target groups (blue/green + canary)
│   ├── eks-helm/             same app as a Helm chart
│   ├── eks-gitops/           Argo CD pulls the manifests from git
│   └── beanstalk/            PaaS: Elastic Beanstalk (only if Floci supports it)
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
| eks | http://localhost:8090 |
| ec2-asg | http://localhost:8091 |
| serverless | http://plant.localhost:4567 (its own Floci, via a CloudFront alias) |
| ecs-blue-green | http://localhost:8093 |
| eks-helm | http://localhost:8094 |
| eks-gitops | http://localhost:8095 |
| beanstalk | http://localhost:8096 |

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

### Phase 2: `aws/ecs-blue-green/`, release strategies

- Two target groups (blue/green) behind one ALB listener with **weighted forwarding**.
- **Make targets:** `make shift PCT=10` (canary), `make promote` (100% green) and `make rollback`.
- **Test:** deploy green, send 10%, run the smoke tests, promote, and smoke again. Then roll back and smoke again.
- **Optional:** compare with CodeDeploy's ECS blue/green (Floci lists `codedeploy`; verify it).

### Phase 3: `aws/eks-helm/` and `aws/eks-gitops/`, how Kubernetes teams ship

- **eks-helm:** the same app as a Helm chart (`helm/plant/`), deployed with `helm upgrade --install`. The point is to compare it with eks's Kustomize: templating vs patching, values files, and `helm rollback`.
- **eks-gitops:** Argo CD installed in the cluster watches a manifest path in this repo, so a git change becomes a deploy. CI only builds and pushes images, then bumps the image tag.
- Each is a full recipe: its own copy of the EKS platform Terraform (VPC, cluster, RDS, S3, ALB) plus its own delivery method. Neither one references or edits `aws/eks/`.

### Phase 4: `aws/ec2-asg/`, VMs the production way

- A Launch Template plus an Auto Scaling Group behind the ALB.
- **Instance refresh** for rollouts, and self-healing: the test kills an instance and the ASG replaces it.
- Contrast with classic-ec2, which uses single hand-made instances.
- **Floci check:** does `autoscaling` actually launch instances?

### Phase 5: `aws/beanstalk/`, PaaS (only if Floci really runs it)

- Elastic Beanstalk with the Docker platform.
- **Floci check:** if Floci only stores metadata and runs nothing, drop this stage and record why here.

### Phase 6: Cross-cutting upgrades (applied to every stage, not new stages)

- **Remote state:** each stage can switch its own `backend "s3"` on. The bucket comes from a documented one-time CLI step, not from another stage's Terraform.
- **Observability:** CloudWatch log groups, metrics and alarms per stage. Later, an OpenTelemetry collector.
- **Environments:** dev/prod from the same stage code (tfvars per environment), without copying folders.

### Later: `azure/` and `gcp/`

The same app and the same smoke tests, mapped to each cloud's equivalents (App Service / Container Apps / AKS; Cloud Run / GKE). Each needs a local emulator or a scoped real account; decide when we get there.

## Definition of done (every stage)

- [ ] standalone: the folder deploys when copied alone (only `smoke/` and the app source are needed); no `../` paths into another stage
- [ ] `make up` works from zero on a fresh Floci
- [ ] `make check` exits 0 right after apply
- [ ] `make smoke` passes (API steps + Playwright, video uploaded in CI)
- [ ] `make rollout` passes (where the style has a rollout)
- [ ] `make destroy` leaves no containers or resources behind
- [ ] tflint + trivy + shellcheck clean (accepted findings documented in `.trivyignore`)
- [ ] README (diagram, steps, comparison) and FLOCI-NOTES written
- [ ] stage row added to [README.md](README.md) and its CI workflow is green
