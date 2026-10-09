# Cleanup, CI repair and `aws/ecs-alb-auth` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Standing preferences: write the Terraform first, then apply and debug only real failures; merge right away and fix forward; verify CI on the local Gitea (`local-ci/`), not GitHub Actions.

**Goal:** Get every pipeline green again, close two small repo gaps, then add a new stage, `deployment/aws/ecs-alb-auth/`, where the **load balancer** handles sign-in (ALB `authenticate-cognito`) and the **unchanged** `backend/` and `frontend/` run behind it.

**Architecture:** The new stage copies the `aws/ecs` recipe (VPC, ECR, ECS Fargate, RDS, S3, ALB). It adds a Cognito user pool with a hosted-UI domain and a confidential app client. The ALB listener runs `authenticate-cognito` before it forwards a request: browser pages without a session are redirected to the hosted login (`on_unauthenticated_request = "authenticate"`), and `/api/*` calls without a session get 401 (`"deny"`). After sign-in the ALB keeps the session in its own `AWSELBAuthSessionCookie`. The stage runs on its **own** Floci, a dated nightly, because Floci 2.1.0 has no ALB auth support.

**Tech Stack:** Terraform 1.14.6 (aws provider as in `aws/ecs`), Floci `floci/floci:nightly-10012026`, ECS Fargate, Amazon Cognito, Playwright (`@playwright/test` ^1.56), bash, Gitea local CI.

**Spec:** none written separately. The design was agreed in the conversation of 2026-10-09 and is summarised in *Design decisions* below.

## Design decisions (the spec)

- **Why this stage exists:** `ecs-cognito` and `serverless-cognito` verify tokens **inside the app** (copied `backend-auth`). This stage teaches the opposite: auth **at the edge**, with zero app changes. It is a new folder, not a flag on `ecs` or `ecs-cognito` (ROADMAP principle 2).
- **Pre-checked (2026-10-09):** the strings `authenticate-cognito`, `AuthenticateCognitoConfig`, `/oauth2/idpresponse` and `AWSELBAuthSessionCookie` are in the `floci/floci:nightly-10012026` binary and **not** in `2.1.0`. The `x-amzn-oidc-*` header names were **not** found as literals. Whether Floci forwards the identity headers to targets is therefore unknown, and the stage must not depend on them.
- **Gate:** Task 5 is a go/no-go spike. If Floci cannot complete the hosted login round trip, stop after Task 5, record the findings in `FLOCI-NOTES.md` on a throwaway branch, and write a separate plan for the fallback `aws/eks-oidc-proxy` (oauth2-proxy in front of the app on EKS). Do **not** build the fallback in this plan.
- **Real cloud vs Floci:** real ALBs allow authenticate actions only on **HTTPS** listeners. Terraform keeps the HTTPS listener (ACM certificate variable) and switches to HTTP only when `on_floci = true`.
- **Out of scope:** Phase 6 (remote state, environments) gets its own plan afterwards; load tests against this stage (k6 would only measure 302s); logout (an ALB has no logout endpoint, see the README task); per-user data (the plain backend has none, which is the point of the comparison).

## Global Constraints

- Stages are standalone cookbooks: **no shared Terraform, modules or references between stages**. Copy files from `aws/ecs`, do not import them.
- Only shared things may change: `deployment/smoke/` (the new optional hooks), the docs index, the control panel registry, the workflows.
- The stage's own Floci: image `floci/floci:nightly-10012026`, host port **4569**; ALB listener 80 inside that Floci → host **8097**.
- Resource name prefix `plant-ecs-alb-auth`; compose project name `plant-ecs-alb-auth`; ECS docker network `plant-ecs-alb-auth_default`.
- Demo users and password exactly as in `ecs-cognito`: `alice@plant.example`, `bob@plant.example`, password `Plant-Parent-2026!`.
- Images: the unchanged `plant/backend:<tag>` and `plant/frontend:<tag>` built from `backend/` and `frontend/`.
- Shellcheck 0.9.0 clean; `terraform fmt -check`, `validate`, tflint (`../../.tflint.hcl`), trivy config (HIGH/CRITICAL, accepted findings go in `deployment/.trivyignore` with a reason).
- Workflows must run on GitHub and Gitea: steps that differ are guarded with `github.server_url == 'https://github.com'`. Gitea rejects YAML anchors in `on:`.
- Commit messages follow the repo style (`feat(deployment): …`, `fix(ci): …`, `docs: …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Expired or missing session on an API call from the SPA.** Expected: `/api/*` returns **401**, not a 302 to the hosted UI (which `fetch` cannot follow across origins). Covered by `auth-rules.sh` in Task 5 ("anonymous /api/plants → 401").
2. **A forged or garbage session cookie.** Expected: treated as no session (302 for pages, 401 for the API), never 200. Covered by `auth-rules.sh` in Task 5.
3. **Target health checks behind an auth listener.** Expected: targets still turn healthy (health checks go straight to targets and skip listener rules). Covered by `make wait` in Task 3, run again after the auth listener lands in Task 5.
4. **Emulator restart leaves stale state.** Expected: `make forget` plus the panel's "Emulator reset" detection work for the new emulator id. Covered in Task 6 by stopping the stage's Floci and checking the panel's reset badge.
5. **Rollout keeps signed-in users signed in.** Expected: the ALB session cookie survives a new task-definition revision, because the cookie belongs to the ALB, not the tasks. Covered by `make rollout` in Task 5, which reuses the cookie jar from before the rollout.

---

### Task 1: Small repo cleanups

**Files:**
- Delete: `deployment/deployment/` (empty, untracked), `deployment/azure/azure/` (contains only an empty `container-apps/`, untracked)
- Create: `deployment/aws/classic-ec2/README.md` (the only stage without one)

**Interfaces:** none.

- [ ] **Step 1: Confirm the stray folders are empty and untracked**

Run: `find deployment/deployment deployment/azure/azure -type f; git ls-files deployment/deployment deployment/azure/azure`
Expected: no output from either command. If anything is listed, stop and ask the user.

- [ ] **Step 2: Remove them**

Run: `find deployment/deployment deployment/azure/azure -depth -type d -empty -delete && ls deployment deployment/azure`
Expected: `deployment/` no longer lists `deployment`; `deployment/azure` lists only `container-apps`.

- [ ] **Step 3: Write `deployment/aws/classic-ec2/README.md`**

Use the same headings as `deployment/aws/ecs/README.md` (`# … — on Floci`, `## Run it`, `## Redeploying`, `## What each file teaches`, `## Compared with …`). Fill them only from what is in the stage folder: read `Makefile` (targets and their `##` comments), every `*.tf` (one table row per file), `scripts/`, `templates/` and `FLOCI-NOTES.md`. The port is `http://localhost:8088`. The comparison section compares it with `ec2-asg` (hand-made instances vs Launch Template + Auto Scaling Group). Link `FLOCI-NOTES.md` and `../../smoke/`.

- [ ] **Step 4: Check links**

Run: `grep -o '](\([^)]*\))' deployment/aws/classic-ec2/README.md | sed 's/](\(.*\))/\1/' | grep -v '^http' | while read -r p; do [ -e "deployment/aws/classic-ec2/${p%%#*}" ] || echo "broken: $p"; done`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git checkout -b chore/cleanup-classic-ec2-readme
git add deployment/aws/classic-ec2/README.md
git commit -m "docs(deployment): README for aws/classic-ec2, the last stage without one"
```

(The removed folders were untracked, so there is nothing to stage for them.) Open the PR and merge it.

---

### Task 2: Fix the `eks-gitops` local CI failure

**Files:** found while debugging; most likely `deployment/aws/eks-gitops/{Makefile,scripts/*.sh}` or `.github/workflows/eks-gitops.yml`.

**Interfaces:** none. Done when `local-ci/dispatch.sh eks-gitops.yml` prints only `success` lines.

**REQUIRED SUB-SKILL:** superpowers:systematic-debugging. Do not guess a fix before reading the failing step's log.

- [ ] **Step 1: Bring up the local CI and stop competing stacks**

```bash
docker compose stop floci 2>/dev/null || true      # the user's own Floci shares ports with CI jobs
make -C local-ci up
make -C local-ci push BRANCH=ci-test
caffeinate -dimsu &                                 # keep the Mac awake during the run
```

- [ ] **Step 2: Reproduce**

Run: `local-ci/dispatch.sh eks-gitops.yml ci-test`
Expected now: a line `Deploy+verify · eks-gitops -> FAILED` (as in run 16 on 2026-10-05).

- [ ] **Step 3: Read the failing step's log**

Open `http://localhost:3300/ci/FullStack-DevOps/actions` (login `ci` / `ci-password-1`), open the run, and find the **first** failing step and its last 100 lines. Write down the exact error before changing anything.

- [ ] **Step 4: Reproduce outside CI if the log points at the stage itself**

```bash
docker compose up -d --wait floci
cd deployment/aws/eks-gitops && make init && make up && make smoke && make rollout
```

Expected: the same failure as in CI. If it passes locally but fails in CI, the cause is environmental (timing, ports, image load). Compare with the `eks-helm` workflow, which is green and has the same platform.

- [ ] **Step 5: Fix, then prove it in CI**

Make the smallest change that fixes the root cause, then run `make destroy` locally and:

```bash
make -C local-ci push BRANCH=ci-test && local-ci/dispatch.sh eks-gitops.yml ci-test
```

Expected: every job `-> success`.

- [ ] **Step 6: Commit**

```bash
git checkout -b fix/eks-gitops-ci
git add -A deployment/aws/eks-gitops .github/workflows/eks-gitops.yml
git commit -m "fix(ci): eks-gitops <one-line root cause>"
```

Merge right away. Save the root cause to memory if it is a Floci or runner gotcha.

---

### Task 3: Re-run the Azure pipeline

**Files:** none unless it fails (then the debugging rules from Task 2 apply to `deployment/azure/container-apps/` and `.github/workflows/azure-container-apps.yml`).

- [ ] **Step 1: Dispatch**

Run: `local-ci/dispatch.sh azure-container-apps.yml ci-test`
Expected: every job `-> success`. Run 18 was interrupted, so the last real result is unknown.

- [ ] **Step 2: If it fails**, follow Task 2 Steps 3–6 with `azure-container-apps` in place of `eks-gitops`. Known floci-az gotchas (from earlier sessions): ingress hangs on reused connections and refuses internal-ingress calls; Terraform runs in a container that shares the emulator's network namespace.

- [ ] **Step 3: Stop the local CI** once both are green: `make -C local-ci down`. Update the memory file `roadmap-status-*.md` (new dated file) with the results.

---

### Task 4: Scaffold `aws/ecs-alb-auth` on its own Floci (no auth yet)

This proves that ECS, RDS and the ALB work on the nightly Floci **before** auth is added, so a later failure can only come from the auth part.

**Files:**
- Create by copying from `deployment/aws/ecs/`: `versions.tf providers.tf network.tf security.tf ecr.tf storage.tf iam.tf database.tf ecs.tf alb.tf outputs.tf variables.tf Makefile .terraform.lock.hcl`
- Create: `deployment/aws/ecs-alb-auth/compose.yaml`
- Modify (in the copies): `variables.tf`, `Makefile`, `providers.tf`

**Interfaces:**
- Produces: Make targets `floci init repos images push deploy apply wait health check smoke rollout logs destroy forget`, and the outputs `app_url`, `media_bucket`, `backend_target_group_arn`, `frontend_target_group_arn`, the same as `aws/ecs`.

- [ ] **Step 1: Copy the recipe**

```bash
mkdir -p deployment/aws/ecs-alb-auth
cd deployment/aws/ecs
cp versions.tf providers.tf network.tf security.tf ecr.tf storage.tf iam.tf database.tf ecs.tf alb.tf outputs.tf variables.tf Makefile .terraform.lock.hcl ../ecs-alb-auth/
cd ../ecs-alb-auth && grep -rn "4566\|plant-ecs\b\|8089\|= 81" .
```

The grep lists every place that has to change in Steps 2–4.

- [ ] **Step 2: Own emulator — `compose.yaml`**

```yaml
# This stage's own Floci on :4569, so it touches neither the shared one (4566) nor the serverless ones (4567, 4568).
#
# Why a separate emulator: the pinned release (2.1.0) has no ALB authenticate-cognito action. The dated
# nightly has it (listener action, hosted-UI round trip, AWSELBAuthSessionCookie). Pin a release once one has it.
name: plant-ecs-alb-auth

services:
  floci:
    image: floci/floci:nightly-10012026
    ports:
      - "4569:4566"
      - "8097:80" # ALB listener → http://localhost:8097
    environment:
      FLOCI_NETWORK_SECURITY_GROUP_ENFORCEMENT_ENABLED: "true"
      # ECS task containers join this compose network, so the ALB and the RDS proxy reach them.
      FLOCI_SERVICES_ECS_DOCKER_NETWORK: plant-ecs-alb-auth_default
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

- [ ] **Step 3: Variables — edit the copied `variables.tf`**

Change these defaults and add `on_floci`:

```hcl
variable "floci_endpoint" {
  description = "This stage's own Floci as seen from this machine (see compose.yaml)."
  type        = string
  default     = "http://localhost:4569"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-ecs-alb-auth"
}

variable "alb_listener_port" {
  description = "Listener port inside this stage's Floci (published as alb_host_port). Real AWS uses 443."
  type        = number
  default     = 80
}

variable "alb_host_port" {
  description = "Host port compose.yaml publishes for the ALB listener."
  type        = number
  default     = 8097
}

variable "on_floci" {
  description = "True on Floci: an HTTP listener (Floci has no ACM). False on real AWS: HTTPS, which ALB authentication requires."
  type        = bool
  default     = true
}
```

Check that `providers.tf` reads `var.floci_endpoint` for every endpoint. If it hard-codes `4566`, replace that with the variable.

- [ ] **Step 4: Makefile — own emulator and own names**

In the copied `Makefile`:
- Header comment: `# ECS (Fargate) + ALB sign-in (Amazon Cognito at the load balancer) on this stage's own Floci. Run from this directory.`
- `FLOCI := http://localhost:4569`, and below it `export FLOCI_ENDPOINT := $(FLOCI)` (read by `../../smoke/api-smoke.sh`).
- `REGISTRY := 000000000000.dkr.ecr.$(AWS_REGION).localhost:4569`
- Every `plant-ecs-$$svc` becomes `plant-ecs-alb-auth-$$svc`, and `--cluster plant-ecs` becomes `--cluster plant-ecs-alb-auth`.
- Add `floci` to `.PHONY` and this target:

```make
floci: ## start this stage's Floci (a nightly with ALB authentication; see compose.yaml)
	docker compose up -d --wait
```

- `logs`: change the container filter to `grep -i -E 'alb-auth.*(backend|frontend)'`. Confirm the real container names with `docker ps` in Step 6 and adjust if needed.

- [ ] **Step 5: Static checks**

```bash
cd deployment/aws/ecs-alb-auth
terraform fmt -check && terraform init -backend=false -input=false >/dev/null && TF_VAR_image_tag=x terraform validate
tflint --config ../../.tflint.hcl --init && tflint --config ../../.tflint.hcl --format compact
```

Expected: `Success! The configuration is valid.` and no tflint findings.

- [ ] **Step 6: Deploy without auth and prove the platform works on the nightly**

```bash
make floci && make init && make images push deploy && make wait && make check && make smoke
```

Expected: both target groups `healthy`, `make check` exits 0, `SMOKE PASSED`, and Playwright passes against `http://localhost:8097`. If ECS or RDS fails here, it is a nightly regression: write it in `FLOCI-NOTES.md`, try `floci/floci:nightly-09302026`, and ask the user before going on.

- [ ] **Step 7: Commit (branch `feat/ecs-alb-auth`)**

```bash
git checkout -b feat/ecs-alb-auth
git add deployment/aws/ecs-alb-auth
git commit -m "feat(deployment): aws/ecs-alb-auth scaffold: the ecs recipe on its own nightly Floci (:4569, app on :8097)"
```

Do not merge yet. The stage is only complete after Task 5.

---

### Task 5: GO/NO-GO spike — Cognito + `authenticate-cognito` listener

**Files:**
- Create: `deployment/aws/ecs-alb-auth/cognito.tf`
- Modify: `deployment/aws/ecs-alb-auth/alb.tf` (listener and API rule), `variables.tf` (users, password, domain, certificate), `outputs.tf`

**Interfaces:**
- Consumes: `aws_lb.main`, `aws_lb_target_group.app["frontend"|"backend"]` from Task 4.
- Produces: outputs `cognito_user_pool_id`, `cognito_hosted_ui` (string URL), used by the scripts in Task 6.

- [ ] **Step 1: Variables (append to `variables.tf`)**

```hcl
variable "demo_users" {
  description = "Demo users created in the pool (email → settings)."
  type        = map(object({}))
  default = {
    "alice@plant.example" = {}
    "bob@plant.example"   = {}
  }
}

variable "demo_password" {
  description = "Password of every demo user. Demo only: real users are invited and pick their own."
  type        = string
  default     = "Plant-Parent-2026!"
  sensitive   = true
}

variable "cognito_domain_prefix" {
  description = "Hosted-UI domain prefix (<prefix>.auth.<region>.amazoncognito.com). Must be unique per region on real AWS."
  type        = string
  default     = "plant-ecs-alb-auth"
}

variable "certificate_arn" {
  description = "ACM certificate for the HTTPS listener on real AWS. Unused on Floci."
  type        = string
  default     = null
}

variable "public_url" {
  description = "Public origin of the app on real AWS (https://plants.example.com). The callback is <public_url>/oauth2/idpresponse."
  type        = string
  default     = null
}
```

- [ ] **Step 2: `cognito.tf`**

```hcl
# Sign-in at the load balancer: a Cognito user pool with a hosted login page (the domain) and one app
# client that belongs to the ALB, not to the browser. The app behind the ALB never sees a password or a token
# it has to check: the ALB signs people in and keeps the session in its own cookie.

resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

# The hosted UI: Cognito's own login page. The ALB sends visitors without a session here.
resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

locals {
  app_origin   = var.on_floci ? "http://localhost:${var.alb_host_port}" : var.public_url
  callback_url = "${local.app_origin}/oauth2/idpresponse" # the ALB's own path; no app route needed
}

# A confidential client: the ALB keeps the secret and runs the authorization-code flow on the server side.
# (ecs-cognito's client is public and has no secret, because the browser app uses it.)
resource "aws_cognito_user_pool_client" "alb" {
  name         = "${var.name}-alb"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [local.callback_url]

  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user" "demo" {
  for_each     = var.demo_users
  user_pool_id = aws_cognito_user_pool.main.id
  username     = each.key
  password     = var.demo_password

  attributes = {
    email          = each.key
    email_verified = "true"
  }
}
```

- [ ] **Step 3: Listener with authentication — replace the listener and the API rule in `alb.tf`**

```hcl
# Every request passes the authenticate action first. No session cookie: pages are redirected to the
# hosted login, API calls get 401 (a fetch() cannot follow a redirect to another origin). Valid session:
# the next action (forward) runs. Real AWS allows this only on an HTTPS listener.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.on_floci ? var.alb_listener_port : 443
  protocol          = var.on_floci ? "HTTP" : "HTTPS"
  certificate_arn   = var.on_floci ? null : var.certificate_arn
  ssl_policy        = var.on_floci ? null : "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = aws_cognito_user_pool.main.arn
      user_pool_client_id        = aws_cognito_user_pool_client.alb.id
      user_pool_domain           = aws_cognito_user_pool_domain.main.domain
      on_unauthenticated_request = "authenticate"
      scope                      = "openid email"
      session_timeout            = 3600 # seconds; the ALB then sends the user through the login again
    }
  }

  default_action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.app["frontend"].arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = aws_cognito_user_pool.main.arn
      user_pool_client_id        = aws_cognito_user_pool_client.alb.id
      user_pool_domain           = aws_cognito_user_pool_domain.main.domain
      on_unauthenticated_request = "deny" # 401 instead of a redirect
      scope                      = "openid email"
      session_timeout            = 3600
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.app["backend"].arn
  }
}
```

The real-AWS listener needs port 443 open in the ALB security group. Read `security.tf`: if the ingress rule uses `var.alb_listener_port`, change it to `var.on_floci ? var.alb_listener_port : 443`.

- [ ] **Step 4: Outputs (append to `outputs.tf`)**

```hcl
output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_hosted_ui" {
  description = "Where the ALB sends visitors without a session."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}
```

- [ ] **Step 5: Validate, then apply**

```bash
terraform fmt && TF_VAR_image_tag=x terraform validate && make deploy && make wait
```

Expected: the apply succeeds, and the targets are still healthy (Review Focus 3).

- [ ] **Step 6: GATE A — anonymous requests are stopped**

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8097/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8097/api/plants
```

Expected: the first prints `302` and a URL containing `/oauth2/authorize` and `client_id=`. The second prints `401`.
**If both still return 200:** Floci stores the action but does not enforce it. That is **NO-GO** (go to Step 9).

- [ ] **Step 7: GATE B — a person can sign in**

```bash
curl -s -L -o /tmp/alb-login.html -w '%{http_code} %{url_effective}\n' http://localhost:8097/
grep -o '<form[^>]*>\|<input[^>]*name="[^"]*"' /tmp/alb-login.html
```

Expected: `200` on a hosted-login URL reachable from this machine, and a form with inputs named `username` and `password` (real Cognito's names). Write down the exact URL host and port, the form `action` and the input names. Task 6's login script relies on them.
Then sign in by hand in a browser at `http://localhost:8097` as `alice@plant.example` / `Plant-Parent-2026!`. Expected: back on `http://localhost:8097/` with the garden page, and DevTools shows an `AWSELBAuthSessionCookie-0` cookie.
**If the redirect points at a host the machine cannot reach** (for example `localhost:4566` instead of `4569`): look for a Floci hostname or base-URL setting (`docker run --rm floci/floci:nightly-10012026 /app/application --help`, Floci docs). If one exists, set it in `compose.yaml` and retry. If none exists, it is **NO-GO**.

- [ ] **Step 8: Observation (not a gate) — identity headers**

Run: `docker exec "$(docker ps --format '{{.Names}}' | grep -i 'alb-auth.*backend' | head -1)" sh -c 'command -v tcpdump || echo no-tcpdump'`. If that is not possible, check the Floci log for request headers: `docker compose logs floci | grep -i 'x-amzn-oidc' | head`.
Write in `FLOCI-NOTES.md` whether `x-amzn-oidc-identity`, `x-amzn-oidc-accesstoken` and `x-amzn-oidc-data` reach the targets. The stage does not depend on them either way.

- [ ] **Step 9: Decide**

- **GO** (Gates A and B pass): commit and continue with Task 6.

```bash
git add deployment/aws/ecs-alb-auth
git commit -m "feat(deployment): ecs-alb-auth: Cognito user pool, hosted UI and authenticate-cognito on the ALB listener"
```

- **NO-GO:** `make destroy`, write the exact failing gate, the commands and the outputs into `deployment/aws/ecs-alb-auth/FLOCI-NOTES.md`, commit that on the branch, **do not merge**, and report to the user with a proposal to write the `aws/eks-oidc-proxy` plan.

---

### Task 6: Smoke hooks, auth rules, rollout — the stage passes the shared tests

**Files:**
- Create: `deployment/smoke/hosted-login.mjs` (shared, optional helper: signs in through any hosted login page and saves the session)
- Modify: `deployment/smoke/api-smoke.sh:16-17` (curl wrapper), `deployment/smoke/playwright.config.ts` (`storageState`), `deployment/smoke/README.md` (document the two hooks)
- Create: `deployment/aws/ecs-alb-auth/scripts/auth-rules.sh`
- Modify: `deployment/aws/ecs-alb-auth/Makefile` (`login`, `smoke`, `rollout`)

**Interfaces:**
- Consumes: the login form facts from Task 5 Step 7 (input names `username` and `password`, submit button).
- Produces (shared smoke hooks, both optional, so other stages are unchanged):
  - `SMOKE_COOKIE_JAR=<path>`: `api-smoke.sh` sends that Netscape cookie jar with every request.
  - `SMOKE_STORAGE_STATE=<path>`: Playwright starts every test with that saved browser state (cookies).
  - `node hosted-login.mjs <base_url> <user> <password> <out_dir>` writes `<out_dir>/state.json` (Playwright storage state) and `<out_dir>/cookies.txt` (Netscape jar), and exits non-zero on failure.

- [ ] **Step 1: Write the failing rules script — `scripts/auth-rules.sh`**

```bash
#!/usr/bin/env bash
# `check && pass … || fail …` is intended below: pass only prints, fail exits.
# shellcheck disable=SC2015
# What the load balancer lets through, before and after sign-in. The app behind it is the unchanged
# backend/ and frontend/: every rule checked here is enforced by the ALB alone.
# Usage: auth-rules.sh <base_url> <cookie_jar>
set -euo pipefail
BASE=${1:?base url}; JAR=${2:?cookie jar from hosted-login.mjs}
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# --- no session
[ "$(code "$BASE/")" = 302 ] && pass "page without a session → 302" || fail "page was served without a session"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/")
[[ $loc == *"/oauth2/authorize"*"client_id="* || $loc == *"client_id="*"/oauth2/authorize"* ]] \
  && pass "… to the Cognito hosted login" || fail "redirect goes to $loc"
[ "$(code "$BASE/api/plants")" = 401 ] && pass "API without a session → 401 (deny, not a redirect)" || fail "anonymous API call was not denied"
[ "$(code -X POST "$BASE/api/plants" -H 'content-type: application/json' -d '{"name":"x","water_every_days":1}')" = 401 ] \
  && pass "anonymous create → 401" || fail "anonymous create"

# --- forged session: the ALB encrypts its cookie, so a made-up value is no session at all
[ "$(code -H 'Cookie: AWSELBAuthSessionCookie-0=forged' "$BASE/api/plants")" = 401 ] && pass "forged session cookie → 401" || fail "forged cookie accepted"
[ "$(code -H 'Cookie: AWSELBAuthSessionCookie-0=forged' "$BASE/")" = 302 ] && pass "forged cookie on a page → back to login" || fail "forged cookie served a page"

# --- signed in
[ "$(code -b "$JAR" "$BASE/api/plants")" = 200 ] && pass "signed in: API → 200" || fail "signed-in API call refused"
curl -s -b "$JAR" "$BASE/" | grep -q '<div id="root">' && pass "signed in: the app page" || fail "signed-in page is not the app"

echo "AUTH RULES PASSED"
```

```bash
chmod +x deployment/aws/ecs-alb-auth/scripts/auth-rules.sh
shellcheck deployment/aws/ecs-alb-auth/scripts/auth-rules.sh
deployment/aws/ecs-alb-auth/scripts/auth-rules.sh http://localhost:8097 /nonexistent
```

Expected: the no-session checks pass and the script then **fails** at "signed-in API call refused" (there is no jar yet).

- [ ] **Step 2: `deployment/smoke/hosted-login.mjs`**

```js
// Signs in through a hosted login page (for example the Cognito hosted UI in front of an ALB) the way a person
// would, then saves the session: state.json for Playwright (SMOKE_STORAGE_STATE) and cookies.txt for curl
// (SMOKE_COOKIE_JAR). Usage: node hosted-login.mjs <base_url> <user> <password> <out_dir>
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [base, user, password, out] = process.argv.slice(2)
if (!base || !user || !password || !out) {
  console.error('usage: node hosted-login.mjs <base_url> <user> <password> <out_dir>')
  process.exit(2)
}

const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER_CHANNEL || undefined })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(base) // the load balancer redirects to the login page
  await page.locator('input[name="username"]:visible').fill(user)
  await page.locator('input[name="password"]:visible').fill(password)
  await page.locator('[type="submit"]:visible').first().click()
  await page.waitForURL((url) => url.href.startsWith(base), { timeout: 30_000 })

  mkdirSync(out, { recursive: true })
  await context.storageState({ path: join(out, 'state.json') })
  const jar = (await context.cookies()).map((c) =>
    [c.domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path,
      c.secure ? 'TRUE' : 'FALSE', Math.max(0, Math.round(c.expires)), c.name, c.value].join('\t'))
  writeFileSync(join(out, 'cookies.txt'), ['# Netscape HTTP Cookie File', ...jar, ''].join('\n'))
  console.log(`signed in as ${user}; session saved in ${out}`)
} finally {
  await browser.close()
}
```

If Task 5 Step 7 found different input names, change the two `input[name=…]` selectors to match and note it in a comment.

- [ ] **Step 3: Shared hooks**

`deployment/smoke/api-smoke.sh`, replace the curl wrapper (lines 16–17):

```bash
# Stages with sign-in set SMOKE_AUTH_TOKEN (a Cognito access token) or SMOKE_COOKIE_JAR (a session cookie
# from a hosted login, e.g. an ALB with authenticate-cognito): every request carries it.
curl() { command curl ${SMOKE_AUTH_TOKEN:+-H "Authorization: Bearer $SMOKE_AUTH_TOKEN"} ${SMOKE_COOKIE_JAR:+-b "$SMOKE_COOKIE_JAR"} "$@"; }
```

`deployment/smoke/playwright.config.ts`, add to the `use:` block:

```ts
    // SMOKE_STORAGE_STATE: a saved signed-in browser (hosted-login.mjs) for stages that sign in at the load balancer.
    storageState: process.env.SMOKE_STORAGE_STATE || undefined,
```

Add one short section to `deployment/smoke/README.md` that names `SMOKE_COOKIE_JAR`, `SMOKE_STORAGE_STATE` and `hosted-login.mjs`, with the usage line.

- [ ] **Step 4: Makefile — `login`, `smoke`, `rollout`**

In `deployment/aws/ecs-alb-auth/Makefile`, add `login` to `.PHONY` and replace `smoke` and the last line of `rollout`:

```make
# Signed-in browser state + cookie jar (git-ignored). No trailing comment: make would keep the spaces in the value.
SESSION := $(CURDIR)/.session
URL      = $$(terraform output -raw app_url)

login: ## sign in through the hosted login page as alice and save the ALB session
	cd $(SMOKE) && npm ci --silent && { [ -n "$$SMOKE_BROWSER_CHANNEL" ] || npx playwright install chromium >/dev/null; } \
		&& node hosted-login.mjs "$$(cd $(CURDIR) && terraform output -raw app_url)" alice@plant.example 'Plant-Parent-2026!' $(SESSION)

smoke: login ## who the ALB lets through, the shared API smoke and the browser tests, all signed in as alice
	scripts/auth-rules.sh "$(URL)" $(SESSION)/cookies.txt
	SMOKE_COOKIE_JAR=$(SESSION)/cookies.txt $(SMOKE)/api-smoke.sh "$(URL)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && SMOKE_STORAGE_STATE=$(SESSION)/state.json SMOKE_STAGE=ecs-alb-auth \
		SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test
```

In `rollout`, the last line becomes (the cookie from **before** the rollout must still work, Review Focus 5):

```make
	SMOKE_COOKIE_JAR=$(SESSION)/cookies.txt $(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)" | tail -1
```

and add `login` as a prerequisite: `rollout: login ## …`. Add `.session/` to `deployment/aws/ecs-alb-auth/.gitignore` (create it, with the same entries as the other stages' ignore rules: check `git check-ignore -v deployment/aws/ecs/terraform.tfstate` to see where they come from).

- [ ] **Step 5: Run everything**

```bash
cd deployment/aws/ecs-alb-auth && make smoke && make rollout && make check
```

Expected: `AUTH RULES PASSED`, `SMOKE PASSED`, all Playwright tests passed (the sign-in spec is skipped because `SMOKE_LOGIN_USER` is unset), revisions change in `rollout` and its API smoke passes with the old cookie, `make check` exits 0.
If Playwright plant tests land on the login page, the storage state did not apply: print `jq '.cookies[].domain' .session/state.json` and compare it with the `SMOKE_BASE_URL` host (`localhost`).

- [ ] **Step 6: Other stages are unaffected**

```bash
cd ../ecs-cognito && grep -c SMOKE_COOKIE_JAR ../../smoke/api-smoke.sh   # 1
shellcheck ../../smoke/*.sh
```

The hooks are no-ops when unset. A full rerun of another stage happens in CI in Task 7 (`deployment/smoke/**` changes trigger every workflow).

- [ ] **Step 7: Commit**

```bash
git add deployment/smoke deployment/aws/ecs-alb-auth
git commit -m "feat(deployment): ecs-alb-auth passes the shared smoke tests signed in through the hosted login (new optional hooks SMOKE_COOKIE_JAR, SMOKE_STORAGE_STATE)"
```

---

### Task 7: Docs, control panel, CI workflow — and merge

**Files:**
- Create: `deployment/aws/ecs-alb-auth/README.md`, `deployment/aws/ecs-alb-auth/FLOCI-NOTES.md`
- Create: `.github/workflows/ecs-alb-auth.yml`
- Modify: `deployment/README.md` (stage table), `deployment/ROADMAP.md` (tree, port table, a phase entry), `README.md` (deployments table, lessons table), `control-panel/server.py` (`EMULATORS`, `STAGES`)

**Interfaces:**
- Consumes: Make targets `floci init push deploy wait check smoke rollout destroy health logs` from Tasks 4–6.

- [ ] **Step 1: README.md for the stage**

Sections: what it is (auth at the edge, unchanged app); a diagram

```
browser ──► ALB :8097 ──[authenticate-cognito]──► no session? ── page → 302 hosted login ─► /oauth2/idpresponse ─► cookie
                              │                              └─ /api/* → 401
                              └── session ok ──► forward ──► frontend / backend (unchanged)
```

`## Run it` (`make floci init images push deploy wait smoke`, open http://localhost:8097, alice / bob, `Plant-Parent-2026!`); `## What each file teaches` (one row per file, with `cognito.tf` and `alb.tf` explained); `## Compared with ecs-cognito`, a table: *where the token is checked* (ALB vs Go middleware), *app changes* (none vs `backend-auth` + `frontend-auth`), *per-user data* (no: the app does not know who is calling unless it reads `x-amzn-oidc-*`, vs yes), *logout* (none built in: expire the cookie and send the user to the hosted `/logout` vs revoke refresh token), *API clients* (only with a browser session, vs bearer tokens), *real-AWS requirement* (HTTPS listener + ACM certificate, vs none). End with "When to choose which".

- [ ] **Step 2: FLOCI-NOTES.md**

The nightly pin and why; the HTTP listener on Floci (gated by `on_floci`); the hosted-UI URL found in Task 5 Step 7; the identity-header observation from Task 5 Step 8; any workaround made during Tasks 4–6.

- [ ] **Step 3: Index docs**

- `deployment/README.md` stage table row: `| [ecs-alb-auth](aws/ecs-alb-auth/) | ECS Fargate + ALB authenticate-cognito + RDS + S3 | sign-in at the load balancer: hosted UI, confidential app client, ALB session cookie, 302 for pages vs 401 for the API; the unchanged backend/ and frontend/ |`
- `deployment/ROADMAP.md`: add `│   ├── ecs-alb-auth/         ✅ ECS + sign-in at the ALB (authenticate-cognito), unchanged app` to the tree, `| ecs-alb-auth | http://localhost:8097 (own Floci :4569) |` to the port table, and a short "Authentication at the edge" section after the Cognito one.
- `README.md`: one row in the deployments table (`:8097`) and one in the lessons table, in the same style as the `ecs-cognito` rows.

- [ ] **Step 4: Control panel**

In `control-panel/server.py`, add to `EMULATORS` (after `serverless-cognito`):

```python
    dict(id="ecs-alb-auth", title="Floci · AWS nightly · ALB auth", cloud="aws", port=4569, dir="deployment/aws/ecs-alb-auth",
         container="plant-ecs-alb-auth-floci-1", start="make floci", stop="docker compose down"),
```

and to `STAGES` (after `ecs-cognito`):

```python
    dict(id="ecs-alb-auth", title="ECS + ALB sign-in", family="aws", kind="container", dir="aws/ecs-alb-auth", emulator="ecs-alb-auth",
         port=8097, start="make floci init apply wait", note="Sign-in at the load balancer (authenticate-cognito), unchanged app",
         login={"users": ["alice@plant.example", "bob@plant.example"], "password": "Plant-Parent-2026!"}),
```

Do **not** add it to `LOADTEST_STAGES`. Run `docker ps --format '{{.Names}}' | grep alb-auth` to confirm the container name `plant-ecs-alb-auth-floci-1`. Then:

```bash
make -C control-panel test
```

Expected: the panel's Playwright suite passes. If a test counts stages, update the count. Then check by hand: start the panel (`make -C control-panel run`), deploy the stage from it, and stop its Floci (`docker compose -f deployment/aws/ecs-alb-auth/compose.yaml stop`). The card must show "Emulator reset" (Review Focus 4). Then `make forget`.

- [ ] **Step 5: Workflow `.github/workflows/ecs-alb-auth.yml`**

Copy `.github/workflows/ecs-cognito.yml` and change it as follows. The rest stays as it is, including both artifact upload/download pairs and the summary job.
- Header comment and `name:`: `"AWS · ECS + ALB sign-in"`; `run-name` likewise.
- `paths:` (in **both** `push` and `pull_request`, spelled out, no anchors): `backend/**`, `frontend/**`, `deployment/aws/ecs-alb-auth/**`, `deployment/smoke/**`, `.github/workflows/ecs-alb-auth.yml`.
- `backend` job: `go-version-file: backend/go.mod`, `cache-dependency-path: backend/go.sum`, `working-directory: backend`. `frontend` job: `frontend` paths.
- `iac` job: `working-directory` and `scan-ref` → `deployment/aws/ecs-alb-auth`; shellcheck `smoke/*.sh aws/ecs-alb-auth/scripts/*.sh`.
- `build-images`: build `plant/backend:${IMAGE_TAG}` from `backend` and `plant/frontend:${IMAGE_TAG}` from `frontend`, and scan and save those two.
- `deploy` job: `working-directory: deployment/aws/ecs-alb-auth`; replace "Start Floci" with `run: make floci` (no `working-directory: .`); the deploy step `make init && make push deploy`; smoke step name `"Verify: ALB sign-in rules + API smoke + browser tests signed in through the hosted login"`; diagnostics use `docker compose logs floci | tail -150`; the recording artifact name is `e2e-recording-ecs-alb-auth`; add `docker compose down` after `make destroy` in the Destroy step; the teardown check greps `alb-auth`.

Then:

```bash
make -C local-ci up && git push -u origin feat/ecs-alb-auth
make -C local-ci push BRANCH=ci-test && local-ci/dispatch.sh ecs-alb-auth.yml ci-test
```

Expected: every job `-> success`. Because `deployment/smoke/**` changed, also run `local-ci/dispatch.sh ecs-cognito.yml ci-test` and `local-ci/dispatch.sh containers.yml ci-test` to prove the shared hooks broke nothing.

- [ ] **Step 6: Commit, PR, merge**

```bash
git add .github/workflows/ecs-alb-auth.yml deployment README.md control-panel/server.py
git commit -m "feat(deployment): aws/ecs-alb-auth stage: sign-in at the ALB with Amazon Cognito, unchanged app; workflow, panel, docs"
gh pr create --fill --body "$(printf 'Adds aws/ecs-alb-auth: Cognito sign-in enforced by the ALB (authenticate-cognito) in front of the unchanged backend/ and frontend/, on its own nightly Floci (:4569, app :8097). New optional smoke hooks SMOKE_COOKIE_JAR / SMOKE_STORAGE_STATE + hosted-login.mjs.\n\nLocal CI: ecs-alb-auth, ecs-cognito, containers green.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')"
gh pr merge --merge
```

Then write a new dated `roadmap-status` memory: what was merged, the GO result, and that Phase 6 is next with its own plan.

---

## After this plan

- **Phase 6** (remote state per stage, dev/prod tfvars) gets its own spec and plan.
- **Fallback B** (`aws/eks-oidc-proxy`) only gets a plan if Task 5 was NO-GO, or if the user wants it as an extra lesson anyway.
