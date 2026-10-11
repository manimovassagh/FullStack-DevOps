# Platform roadmap: next improvements

Cross-cutting work that makes the lab a better DevOps example. New deployment styles live in
[deployment/ROADMAP.md](../deployment/ROADMAP.md); this list is about the platform around them.
Tick items as they land, and add your own anywhere.

Effort: **S** = an hour or two · **M** = half a day to a day · **L** = several days.

## 1. Quick wins: repo hygiene and developer experience

- [ ] **pre-commit hooks** (S): `terraform fmt`, `tflint`, `gofmt`/`go vet`, `oxlint`, `shellcheck`, trailing whitespace, YAML check. One `.pre-commit-config.yaml`, `make hooks` to install. CI runs the same hooks, so local and CI agree.
- [ ] **`.editorconfig`** (S): one indentation and newline style for Go, TS, Terraform, YAML, Makefiles.
- [ ] **`CONTRIBUTING.md`** (S): how to add a stage (link the rules in deployment/ROADMAP.md), how to run local CI, the "one pipeline at a time" rule.
- [ ] **Architecture Decision Records** (S): `docs/adr/`, one short page per decision already made: why Floci, why stages never share Terraform, why local CI on Gitea, why `apps/` + `platform/`, why the `signup` naming, why Floci `nightly-10102026` for the serverless stages.
- [ ] **Dependabot** (S): weekly PRs for Go modules, npm, Terraform providers and GitHub Actions. Mostly to keep dependencies fresh (the `golang.org/x/net` bump would have arrived as a PR).
- [ ] **Loose ends from the local-CI run** (S):
  - [ ] serverless workflows: teardown also runs `docker compose down`, and the "nothing left running" check matches the `plant-…` emulator names (today it only looks for `floci-…`).
  - [ ] remove the stale `dev/**` path filters from the workflows (the folder no longer exists).

## 2. Local HTTPS for everything (M)

Today every local URL is plain HTTP. Goal: the same lab, but on `https://` with a certificate the Mac trusts, so it looks and behaves like a real deployment (Secure cookies, HSTS, mixed-content rules).

- [ ] **A local certificate authority:** `mkcert` (already installed) creates a CA that macOS and the browsers trust, then one wildcard certificate, e.g. for `*.lab.localhost`.
- [ ] **One TLS front door:** a Caddy container on `:443` terminates TLS with that certificate and routes by hostname to what runs today:

  | URL | goes to |
  |---|---|
  | `https://mission-control.lab.localhost` | Mission Control `:3500` |
  | `https://ci.lab.localhost` | Gitea `:3300` |
  | `https://grafana.lab.localhost` | Grafana `:3400` |
  | `https://<stage>.lab.localhost` | each stage's app (e.g. ecs `:8089`, ecs-cloudfront-signup via Floci CloudFront `:4572`) |

- [ ] **`make tls`** (create the CA once and the certificate) and **`make https-up` / `https-down`**; Mission Control links switch to the `https://` names when the proxy runs.
- [ ] **Things to check while doing it:**
  - Floci's CloudFront routes by `Host` header: the proxy must pass the original host.
  - Apps that set cookies: with HTTPS, `COOKIE_SECURE` can be `true` locally too, as on real AWS.
  - Sign-in callbacks (Cognito hosted login in ecs-alb-auth, oauth2-proxy redirect URL) and Gitea's `ROOT_URL` must use the `https://` names.
  - Playwright and the shell smoke tests must trust the mkcert CA (`NODE_EXTRA_CA_CERTS`, `curl --cacert`).
  - Local CI stays on HTTP inside its containers (jobs talk to emulators directly); HTTPS is for people using the lab.

## 3. Environments and promotion: "Phase 6" (L)

- [ ] **Remote Terraform state** with locking for one stage first (e.g. `ecs`), stored in the emulator's S3 (+ lockfile), instead of a local `terraform.tfstate`.
- [ ] **Three environments** (`dev`, `staging`, `prod`) from the same code: per-environment variables, separate state, separate emulator resources.
- [ ] **Promotion pipeline:** build the image once, deploy the same image tag to dev → staging → prod, with a manual approval before prod (an environment protection rule).
- [ ] Mission Control shows which version runs in which environment.

## 4. Observability: from dashboards to operating a service (M–L)

- [ ] **Application metrics:** the Go API exposes `/metrics` (requests, errors, duration per route: RED metrics).
- [ ] **Logs:** Loki + a log shipper; logs searchable in Grafana next to the metrics.
- [ ] **Traces:** OpenTelemetry in the Go API, traces in Tempo; one request followed from the load balancer to the database.
- [ ] **SLOs:** two or three per service (e.g. 99.5 % of API requests answered in < 300 ms), with error-budget dashboards.
- [ ] **Alerting:** Alertmanager with burn-rate alerts on those SLOs; alerts visible in Mission Control.

## 5. Release engineering (M)

- [ ] **Versioned releases:** semantic versions and a generated changelog (e.g. release-please), image tags = versions, not only commits.
- [ ] **Progressive delivery:** a canary for one stage (10 % → 50 % → 100 %) that rolls back automatically when the error rate rises (builds on ecs-blue-green).

## 6. Operations maturity (M)

- [ ] **Chaos tests:** kill a task / pod / Lambda during a load test; the stage must recover and the smoke test must pass.
- [ ] **Backup and restore drill:** CI backs up a stage's database, destroys it, restores it, and checks the data is back.
- [ ] **Runbooks:** one page per stage (how to see health, roll back, read logs), plus a postmortem template.

## 7. Cost visibility (S–M)

- [ ] **Infracost** on pull requests: "this change costs about +$X per month on real AWS" per stage; a cost column in Mission Control.

## 8. Mission Control

- [ ] **Pipeline graph:** the job dependencies of a run drawn like GitHub Actions (Gitea only shows a list).
- [ ] _(add your ideas here)_

## Out of scope on purpose: deep security hardening

This repository is a learning and planning blueprint that runs on emulators. Image signing, SBOMs, policy-as-code gates and similar hardening are deliberately not built here. Anyone taking a stage to real AWS needs a proper security review anyway. Basic hygiene stays (pre-commit, Dependabot, the existing Trivy and tflint checks).

## Known simplifications (kept on purpose, listed so nobody mistakes them for production advice)

- CloudFront → ALB is plain HTTP in the `ecs-cloudfront*` stages (`origin_protocol_policy = "http-only"`); production: an HTTPS listener with an ACM certificate and `https-only`.
- Demo users and a shared demo password live in Terraform variables, and the smoke tests sign in with them.
- Emulator-only workarounds (security-group enforcement off, `on_floci` toggles) are marked in each stage's `FLOCI-NOTES.md`.

## Suggested order

1. Quick wins (section 1), including the two loose ends.
2. Local HTTPS (section 2).
3. Environments and promotion (section 3).
4. Observability (section 4).
5. Then whatever matters most to you from sections 5–8.
