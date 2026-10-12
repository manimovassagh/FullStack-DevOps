# 0002. Stages never share Terraform

Status: accepted

## Context
Many stages look alike (a VPC, a cluster, a load balancer). Shared modules would remove the duplication, but they would also hide the thing each stage is there to teach and couple stages to each other.

## Decision
Every stage under `deployment/<cloud>/<stage>/` is a standalone cookbook: its own Terraform, scripts, compose file, README and notes. Nothing is imported from a sibling stage. Duplication is intentional; a new idea is added as a new stage beside the old ones, which stay untouched.

## Consequences
- A reader can open one folder and see everything that stage does.
- A fix found in one stage is applied by hand to the others that need it.
- The MCP catalog treats every stage independently and derives "builds on" from the README, not from code.
