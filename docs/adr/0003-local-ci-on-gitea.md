# 0003. Local CI on Gitea

Status: accepted

## Context
The workflows in `.github/workflows/` must be proven before they are trusted, and hosted CI minutes are limited.

## Decision
A Gitea server with an Actions runner runs the same workflow files locally (`make ci-up`, then dispatch a workflow). It is the verification path when hosted runners are not available.

## Consequences
- One pipeline at a time: the runner shares the Docker daemon, and parallel runs fight over ports and emulators.
- A sleeping Mac kills running jobs and can hang Docker; long runs need the machine awake.
- Workflows avoid anything the local runner cannot do (for example host name resolution of `*.localhost` inside job containers).
