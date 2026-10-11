# Local CI: Gitea + Actions runner

Runs this repo's own `.github/workflows/*.yml` on your machine, with a GitHub-like web UI. Use it when GitHub Actions is unavailable (billing, quota, offline) or to try a workflow change without pushing.

```bash
make up              # builds the job image, starts Gitea, creates the admin user, registers the runner
make push            # creates the repo in Gitea and pushes your current HEAD to its main branch (this triggers the push workflows)
open http://localhost:3300/ci/FullStack-DevOps/actions     # login: ci / ci-password-1
make status          # every run and job with its state, from the terminal
make logs            # the runner's own output
make down | make reset
```

Push to another branch (`make push BRANCH=try-it`) and start a single workflow without triggering the others:

```bash
curl -u ci:ci-password-1 -X POST http://localhost:3300/api/v1/repos/ci/FullStack-DevOps/actions/workflows/ecs-cognito.yml/dispatches \
  -H 'content-type: application/json' -d '{"ref":"try-it"}'
```

## How it fits

| Piece | What it is |
|---|---|
| Gitea 1.24 (`localhost:3300`, loopback only) | git hosting, the Actions UI, job logs, re-run |
| `act_runner` | executes the jobs, up to three at once (`capacity: 3`) |
| `runner-image/` | the job image: `catthehacker/ubuntu:act-24.04` plus `aws`, `shellcheck`, `jq` (what GitHub's ubuntu-24.04 image has) |

The workflows run unchanged: `runs-on: ubuntu-24.04` is mapped to the job image by the runner's label, `actions/checkout`, `setup-node`, `setup-terraform`, artifacts and `needs` work as on GitHub.

## Things to know

- **One pipeline at a time.** Jobs start Floci, Postgres and the stages on fixed ports (4566, 5432, 8088–8096) of your Docker host. Stop your own `make up` stack first, and do not run two workflows together: they would fight over those ports.
- **Jobs of one pipeline run side by side** (`capacity: 3`), like on GitHub: Backend, Frontend and IaC at once, then Build, then Deploy. Only Backend and Deploy bind the fixed ports, and Deploy waits for Backend. A typical pipeline takes about a third less time than with `capacity: 1`.
- **Gitea's run page is a list, not a graph.** It shows each job with its duration and steps; GitHub draws arrows between dependent jobs. The pipelines are the same.
- **Chromium is baked into the job image** (`runner-image/Dockerfile`, Playwright 1.63.0, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). Jobs no longer download ~150 MB at run time (that download timed out in slow runs). Keep the version in step with `deployment/smoke/package-lock.json` and run `make image` after changing it.
- **Slow first run.** Docker layers, npm and Go modules are downloaded once; the full ECS pipeline is roughly the same as on GitHub, a bit longer.
- **Differences from GitHub:** Gitea's workflow parser rejects YAML anchors in `on:` (so each workflow spells its `paths:` list out twice), the `github.token` is a Gitea token (tflint's plugin download uses no token here), and Gitea 1.24 has no API to list runs (`make status` reads Gitea's database instead).
- **Security.** The runner mounts your Docker socket and its jobs use the host network: any workflow pushed here can control your Docker daemon. That is what lets the workflows run `docker compose` and reach their ports, and it is fine for a local instance that only runs this repo's own workflows. Gitea listens on 127.0.0.1 only, and the admin password is a throwaway (`ADMIN_PASS=... make up` to change it). Do not expose it, and do not point it at repositories you do not trust.
