# 0004. `apps/` and `platform/` beside `deployment/`

Status: accepted

## Context
Application code, the tooling around the lab and the deployment recipes grew in one folder and were hard to tell apart.

## Decision
`apps/` holds the sample applications (Go backends, React frontends), `deployment/` holds one folder per deployment style, and `platform/` holds the lab's own tooling: Mission Control, observability, load tests, the local HTTPS front door. `mcp/` is a separate top-level folder because the MCP servers are a client of the platform, not part of it.

## Consequences
- Stages reference `apps/` for what to build; `apps/` never knows about stages.
- Platform tooling can change without touching a stage.
