# Control panel

The cockpit for the local deployments: see what is up, start and stop stages and emulators, watch the commands live.

```bash
make -C control-panel run      # then open http://localhost:3500
```

## What you see

- **Headline tiles:** how many deployments are up (with a ring), containers running grouped by what they are (ECS tasks, databases, EKS nodes, CI jobs …), Docker memory used vs. available (turns amber and red as it fills), and the current activity.
- **Emulators:** the four Floci emulators (AWS, the serverless nightly, Google Cloud, Azure) with their port, which stages use them, and Start / Stop.
- **Filters and search:** All · Running · Stopped · AWS · Google Cloud · Azure, and a search box (press `/`).
- **One card per stage**, grouped by cloud and style (VMs, containers, Kubernetes, serverless):
  - status: **Running** (the app answers, with "up 12 min"), **Stopped**, **Partly deployed** (Terraform has resources but the app does not answer), or **Starting / Stopping / Testing / Releasing** with a progress bar, time left (learned from earlier runs) and the line the command is on right now;
  - the last run and how long it took;
  - the main action changes with the state: **Start** → **Open app** → (if broken) **Retry** / **Clear state**; plus **Test** (smoke tests), **Release** (rollout), **Stop** (terraform destroy) and **Logs**;
  - the sign-in stage shows its demo user and copies the password.
- **Drawer** (Logs): the live output of the running command with terraform's colours, errors and successes highlighted, a line filter, follow, copy and **Cancel run**; the **History** tab lists every earlier run of that stage and opens its log.
- **Notifications:** a toast when a run ends, and a desktop notification if the tab is in the background.
- Header links to the Grafana dashboard ([observability](../observability/)) and the pipelines ([local-ci](../local-ci/)), with a light that shows whether each is running.

Run history and logs are kept in `control-panel/.history.json` and `control-panel/.logs/` (git-ignored), so they survive a restart of the panel.

## Rules it enforces

- **One operation per emulator.** The eight AWS stages share one Floci, so two applies never race; the other stages wait (their buttons are disabled) until it is done. Serverless, Google Cloud and Azure each have their own emulator and can run next to an AWS stage.
- **Not during CI.** Nothing starts while a local CI job is running on the same Docker (same ports).
- **Fixed commands only.** It runs exactly the commands listed in `server.py`, in the stage's folder; nothing from the browser becomes part of a command.
- **Same-origin only.** Requests need the `X-Panel: 1` header and the panel's own origin, so another website cannot make your browser start deployments.
- **Local only.** It listens on 127.0.0.1 and runs `make` as you. Do not expose it.

Standard-library Python and one HTML file: no dependencies, no build step. Memory is the practical limit: Docker has about 4 GB here, so run two or three stages at a time, not all eleven.
