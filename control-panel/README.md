# Control panel

The cockpit of the local cloud lab: deploy and tear down the stages, watch them live, run load tests and pipelines.
A single-page app (React, Vite, Tailwind, shadcn/ui, Recharts, TanStack Query) served by a small Python API.

```bash
make -C control-panel run      # builds the UI on first run, then http://localhost:3500
make -C control-panel dev      # UI hot reload on :5174 (keep `run` going for the API)
```

| Page | What you do there |
|---|---|
| **Overview** | deployments up, containers by kind, Docker memory, what is running now; the four emulators; live charts (containers, CPU); recent activity |
| **Deployments** | every stage as a card (filters: running, stopped, needs attention, per cloud; search). Deploy, open the app, smoke tests, release, load test, tear down |
| **Deployment detail** | outputs and cloud resources from the Terraform state, the commands behind each button, the live log, every earlier run with its log, and metrics (load balancer targets, ECS tasks or pods, load-test traffic) |
| **Observability** | all containers with CPU and memory, ECS services desired vs running, Kubernetes pods, target health; start/stop Prometheus + Grafana |
| **Load tests** | pick a running deployment and a k6 profile (smoke, load, spike, stress), run it, watch users, requests/s, p95 and errors live |
| **Pipelines** | start/stop the local CI (Gitea), run any workflow, see recent runs and their jobs |
| **Activity** | every run the panel did, filterable, each with its full log |

Every action asks for confirmation in a dialog when it is destructive, then follows the job in a toast (time, current step, result) with a link to the live log drawer (colours, filter, copy, cancel).

## What it handles for you

- **Emulator first.** Any action on an AWS stage starts the shared Floci when it is off.
- **Emulator resets.** The emulators keep everything in memory. After a restart a stage's Terraform state lists resources that no longer exist: the panel checks one of them (the VPC or a bucket) against the emulator, shows the stage as **Emulator reset**, and on Deploy clears the old state first. Tear down on such a stage only clears the state.
- **One operation per emulator, one load test, one pipeline at a time.** Other buttons wait (disabled, with the reason).
- **Not during CI.** Deployments pause while a pipeline job uses Docker (same ports).
- **Fixed commands only**, run in the stage's folder (listed on each detail page). Requests need `X-Panel: 1` and the panel's own origin, so another website cannot drive it. It listens on 127.0.0.1 only.

Run history and logs live in `control-panel/.history.json` and `control-panel/.logs/` (git-ignored). Docker has about 4 GB here: run two or three stages at a time.
