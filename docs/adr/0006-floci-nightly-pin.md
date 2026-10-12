# 0006. Floci `nightly-10102026` for the serverless stages

Status: accepted (2026-10-11)

## Context
Terraform's AWS provider reads a function's newest version as the last entry of `ListVersionsByFunction`. Older Floci builds (`nightly-10012026`, release 2.2.0) returned that list in an order that depended on the function's name, so after `make rollout` the provider read an old version as "latest", planned no alias change, and the alias stayed where it was. Whether a rollout passed depended on the hash of the function name (local CI run 25).

## Decision
The serverless stages pin `floci/floci:nightly-10102026`, which returns `$LATEST 1 2 3` for every name tried. The pin and its reason are in each stage's `compose.yaml` and `FLOCI-NOTES.md`. Do not go back to an older nightly.

## Consequences
- Moving to a release is a deliberate change that needs the serverless pipelines (including the rollout check) to pass again.
- Other stages keep their own pins (see ADR 0001 and 0002).
