# Control panel

A small web page to start and stop the local deployments and see which are up.

```bash
make -C control-panel run      # then open http://localhost:3500
```

It lists every stage (AWS VMs, containers, Kubernetes, serverless; Google Cloud; Azure) with a status:

| Status | Meaning |
|---|---|
| **up** (green) | the app's URL answers |
| **down** (grey) | nothing deployed (no Terraform state) |
| **partly deployed** (red) | Terraform has resources but the app does not answer (still booting, or broken: open the log) |
| **starting / stopping** (amber) | a command is running |

Buttons: **Start** (`make init apply wait` / `make init up` / `make up`, whatever that stage uses; the shared Floci is started first), **Stop** (`make destroy`, after a confirmation), **Test** (`make smoke`), **Release** (`make rollout`), **Log** (the last command's output, also live in the bar at the bottom), **Open** (the app).

The header links to the Grafana dashboard ([observability](../observability/)) and the Gitea pipelines ([local-ci](../local-ci/)).

## Rules it enforces

- One operation at a time per emulator: the eight AWS stages share one Floci, so starting two at once would race. Serverless, Google Cloud and Azure each have their own emulator and can run beside an AWS stage.
- It refuses to start anything while a local CI job runs on the same Docker (same ports).
- It only runs the fixed commands listed in `server.py`, in the stage's own folder. Requests must carry `X-Panel: 1` and come from the page itself, so another website cannot make your browser start deployments.
- It listens on 127.0.0.1 only. It runs `make` as you: do not expose it.

Standard-library Python and one HTML file, no dependencies or build step. Memory is the practical limit: Docker has about 4 GB here, so run two or three stages at a time, not all eleven.
