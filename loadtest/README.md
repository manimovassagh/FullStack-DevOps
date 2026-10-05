# Load tests (k6 → Prometheus → Grafana)

Put realistic load on a deployed stage and watch it live: what users feel (requests per second, latency
percentiles per endpoint, errors) next to what the system does (CPU and memory of the ECS tasks, the database,
running tasks, load balancer health).

```bash
make -C observability up                    # Prometheus + Grafana (once)
# start a stage, e.g. in the control panel (make -C control-panel run)
make -C loadtest smoke STAGE=ecs-cognito    # 1 user, 30 s: does it work at all?
make -C loadtest load  STAGE=ecs-cognito    # ramp to 20 users, hold 3 min
open http://localhost:3400/d/load-test      # live dashboard, 5 s refresh
```

| Profile | Shape | Question it answers |
|---|---|---|
| `smoke` | 1 user, 30 s | does the journey work at all? |
| `load` | 0 → 20 users in 1 min, hold 3 min | normal busy day: stable latency, no errors? |
| `spike` | 5 → 50 users in 10 s, hold 1 min | sudden rush: does it bend or break? |
| `stress` | 20 → 50 → 100 users | where does it start to fail? |

`STAGE` is any stage with a load balancer port: `classic-ec2`, `ecs`, `eks`, `ecs-blue-green`, `ec2-asg`, `eks-helm`, `eks-gitops`, `ecs-cognito`. On `ecs-cognito` every virtual user signs in through Cognito first and uses its own token.

## What each virtual user does

[`plant-journey.js`](plant-journey.js): list the garden and load the frontend, then add a plant, open it, water it and delete it (so the database does not grow), with a short pause between steps like a person. Every request is tagged with its endpoint (`GET /api/plants/:id`, not the URL with the id), so the dashboard shows one line per endpoint.

**Thresholds** make the run fail (non-zero exit, red in the summary) when the app is not good enough: more than 1% failed requests, p95 latency of good requests above 500 ms, or fewer than 99% of checks passing.

## How the metrics get to Grafana

k6 runs in a container on the observability network and pushes its metrics with Prometheus remote write (`-o experimental-prometheus-rw`; Prometheus runs with `--web.enable-remote-write-receiver`). Percentiles are sent as `k6_http_req_duration_p95` etc. Each run gets a `testid` label (`ecs-cognito-load-221530`), which the dashboard's **Test run** selector filters on, so you can compare runs.

The **system under test** panels come from the observability exporter (Docker stats and the Floci API), not from k6.

## Reading it

- Latency rising while requests per second stays flat → the app is saturating; look at the CPU panel to see which container.
- Errors appearing at a certain number of users → that is your capacity on this setup.
- Remember it is an emulator on a laptop: the numbers compare runs and stages with each other, not with real AWS.
