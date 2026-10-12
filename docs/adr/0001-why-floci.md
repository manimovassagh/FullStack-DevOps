# 0001. Floci as the cloud emulator

Status: accepted

## Context
The lab teaches AWS, GCP and Azure deployment styles without a cloud account or a bill. A deploy has to be real enough that Terraform, the provider and the smoke tests exercise the same calls as on a real cloud.

## Decision
Every stage runs against an emulator started by its own compose file: Floci for AWS, with the Terraform AWS provider pointed at it. Versions are pinned (see each stage's `docker-compose.yml`); the serverless stages use a newer nightly (see ADR 0006).

## Consequences
- Emulator gaps are real and are written down per stage in `FLOCI-NOTES.md`, with an `on_floci` toggle where the code differs from real AWS.
- Nothing here proves a stage works on real AWS; it proves the Terraform, the app and the flow are coherent.
- A fix for an emulator bug is a note and a workaround, never a fork of the emulator.
