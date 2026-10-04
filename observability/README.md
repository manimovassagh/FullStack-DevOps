# Observability: what is running in the local stacks

A Grafana dashboard that answers "how many containers, ECS tasks, nodes and pods do I have, and are they healthy?" for whatever stages are running on your Docker, with live refresh (10 s).

```bash
make -C observability up     # builds the exporter, starts Prometheus + Grafana
open http://localhost:3400   # no login (loopback only)
make -C observability status # which sources the exporter reaches
make -C observability down
```

Deploy any stage (ecs, eks, ec2-asg, ecs-blue-green ...) and watch it appear; a `make rollout` shows tasks being replaced.

## What is in it

| Tool | Role |
|---|---|
| **Grafana** (`:3400`) | the dashboard `Plant Parent · local stacks` (provisioned from `grafana/dashboards/overview.json`) |
| **Prometheus** (`:9091`) | stores two days of metrics, scrapes the exporter every 10 s |
| **exporter** (`exporter/app.py`, ~200 lines of Python) | the only custom part: turns what the emulators know into Prometheus metrics |

The exporter reads:
- **Docker**: every container (Floci runs ECS tasks, RDS, EKS nodes, EC2 instances as real containers) with state, CPU and memory, grouped by name (`floci-ecs-*` = ECS tasks, `floci-rds-*` = databases ...);
- **the Floci AWS API**: ECS services (desired / running / pending, deployments in flight, task definition revision), ALB target health, Auto Scaling groups;
- **Kubernetes**: nodes, pods by phase, restarts and deployments (desired vs ready) of every EKS cluster, by running `kubectl` inside its k3s container.

Every source is optional. A stage that is not running just has no rows, and the "Which sources answered" table at the bottom says what the exporter could reach.

## Dashboard sections

Top tiles (containers, ECS tasks, EKS nodes, pods, healthy targets, problems) → containers by group, memory and CPU per container, all containers → ECS services desired vs running → ALB targets and Auto Scaling groups → Kubernetes deployments, pods, restarts.

## Notes

- It looks at the Floci on `localhost:4566` (`FLOCI_ENDPOINT=... make up` for another one, e.g. the serverless Floci on 4567).
- The exporter reads the Docker socket as root and Grafana has no login: a local learning tool, bound to 127.0.0.1. Do not expose it.
- It does not replace CloudWatch: the metrics come from Docker and the control-plane APIs, so there is no AWS metric history (latency, request counts). Prometheus keeps two days.
