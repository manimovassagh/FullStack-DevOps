# Floci notes for the ecs-blue-green stage

Verified against Floci 2.1.0 (pinned in docker-compose). The base behaviour is the same as the [ecs stage](../ecs/FLOCI-NOTES.md).

## What works like real AWS

- **Weighted forwarding.** An ALB `forward` action with two weighted target groups splits traffic by weight, including 0 and 100.
- **Four services and four target groups** behind two listeners (public and preview) on one ALB.
- **Different image tags per environment.** Each task definition pins its own tag.

## Differences

- **Counting who served a request.** Floci keeps no ALB access logs, so `scripts/served-by.sh` tags each request with a unique query-string marker and counts it in the logs of each environment's backend task containers (`docker logs floci-ecs-<task id>-backend`, task ids from `ecs list-tasks`). On AWS you would read ALB access logs or the target-group request-count metrics.
- **Two more published ports.** The ALB listeners (83 public, 84 preview) must be published by `docker-compose.yml` (8091, 8092) so the host can reach them, like the other stages' listeners. Changing ports restarts Floci and wipes every stack.
- **No CodeDeploy.** Real AWS can drive this flow with CodeDeploy's ECS blue/green deployment type (it shifts the weights for you, with hooks and automatic rollback). Here the weights are moved explicitly so you can see each step.
- **A release takes a minute per step** because every step is a real `terraform apply` against four services; AWS waits for service stability on top of that.
