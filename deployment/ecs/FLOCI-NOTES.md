# Floci notes for the ECS stage

Verified against Floci 2.1.0 (pinned in docker-compose). Compared with [classic-ec2](../classic-ec2/FLOCI-NOTES.md), ECS needs far fewer workarounds.

## What works like real AWS

- **ECR** is a real `registry:2` behind Floci: `aws ecr get-login-password | docker login …` then `docker push 000000000000.dkr.ecr.us-east-1.localhost:4566/<repo>:<tag>`. `*.localhost` resolves to loopback, so Docker needs no insecure-registry setting.
- **Fargate tasks** (`awsvpc`) run as real containers named `floci-ecs-<task id>-<container>`.
- **ECS services register their tasks** in the ALB target groups (`target_type = "ip"`) and deregister them on replacement; a new task-definition revision rolls the service.
- **`secrets.valueFrom`** is resolved from Secrets Manager into the container environment (`DATABASE_URL`).

## Differences

- **Network.** Task containers join the Docker network named by `FLOCI_SERVICES_ECS_DOCKER_NETWORK` (set to the compose network in `docker-compose.yml`), not the VPC's subnets. Target IPs are therefore `172.21.x.x`, and the ALB and RDS proxy reach them without the `docker network connect` step classic-ec2 needs.
- **Credentials.** Floci injects `AWS_ENDPOINT_URL` and static credentials into task containers instead of serving task-role credentials. The task role is still declared (it's what real AWS would use) but not enforced.
- **Architecture.** `runtimePlatform` is ignored; tasks run on the Docker host's own CPU. No QEMU needed in CI.
- **Logs.** `awslogs` configuration and the log groups are created, but output stays in Docker: `make logs` (or `docker logs floci-ecs-…`).

## Terraform drift on Floci

- `portMappings` come back with `hostPort = 0` unless set; in `awsvpc` mode `hostPort` must equal `containerPort` anyway, so it's set explicitly.
- Task-definition tags are not stored → `ignore_changes = [tags, tags_all]`.
- Security-group references come back as `000000000000/sg-…` → `ignore_changes` (same as classic-ec2).
