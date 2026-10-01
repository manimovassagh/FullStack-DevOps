# Floci notes for the classic EC2 stage

Facts found by probing Floci 2.1.0 (Rancher Desktop, arm64) before writing the Terraform.
They explain the few places where this stage differs from a real-AWS setup.

## EC2 instances are containers

- `RunInstances` starts a container named `floci-ec2-<instance-id>`. SSH (port 22) is published on the host from port 2200 upwards.
- Floci attaches each instance to three Docker networks: the default bridge, the VPC network (the private IP from your subnet, e.g. `10.0.10.x`), and Floci's own compose network (`172.21.0.0/16`).

## The systemd AMI must be baked locally

`ami-ubuntu2404-cloud` maps to the image `floci/ami-ubuntu:24.04-arm64`, which is **not published**: launching fails with `pull access denied`. Floci uses an image that is already present locally, so `make ami` builds [ami/Dockerfile](ami/Dockerfile) (Ubuntu 24.04 + systemd + sshd) under that tag. With it, `systemctl is-system-running` reports `running`. This is the local equivalent of baking an AMI with Packer.

## What an instance sees

| Variable (injected by Floci) | Value | Works from the instance |
|---|---|---|
| `AWS_ENDPOINT_URL` | `http://localhost.floci.io:4566` | yes (HTTP 200) |
| `AWS_EC2_METADATA_SERVICE_ENDPOINT` | `http://172.21.0.2:9169` | yes (returns the instance id) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `test` | — |

UserData therefore uses the injected `AWS_ENDPOINT_URL`; `instance_aws_endpoint` stays empty. Systemd services don't inherit this environment, so the backend's env file copies both variables.

UserData runs through `docker exec` right after sshd starts, not through cloud-init, so `/var/lib/user-data.sh` is not left on disk. Its output is in the Floci log (`docker compose logs floci`) and in `/var/log/user-data.log` (our scripts `tee` there).

## Port 80 inside an instance is taken by IMDS

Floci serves IMDS inside every instance through a socat listener on `169.254.169.254:80`. A server that binds `0.0.0.0:80` fails with `Address already in use`. nginx on the frontend instance therefore listens on each of the instance's own IPv4 addresses (`listen <ip>:80`) instead of `listen 80`. The backend uses port 8080 and is not affected.

## RDS

`CreateDBInstance` starts a real `postgres:16-alpine` container behind a Floci proxy. The advertised endpoint is Floci's address on the compose network, `172.21.0.2:7001` (the first proxy port), and it is reachable from instances as advertised. `db_host_override` and `db_port_override` stay unset.

## ALB

`CreateListener` binds the listener port inside the Floci container ("ELBv2 listener port started on 80"); docker-compose publishes it as `localhost:8088`. Floci itself can reach an instance on its compose-network IP. Whether the ALB's target health and forwarding succeed with the stage's security groups is verified by the Terraform apply (Task 7). See the stage README for the result.

## ALB quirks

- Floci's ALB connects to targets on their **VPC private IP**, but the Floci container is not attached to the VPC's Docker network (`floci-vpc-4566-<region>-<vpc id>`), so health checks time out. [floci.tf](floci.tf) attaches it (`docker network connect`) after the instances start; with that, both target groups turn `healthy`.
- A `POST` with **no body** through the ALB reaches the Go API as a request its JSON binder rejects (`400 invalid JSON body`); the same request sent directly to the instance works. The frontend always sends a JSON body, so the app is unaffected; the smoke test sends `{}` like the frontend does.

## Terraform drift on Floci

- `referenced_security_group_id` comes back as `000000000000/sg-…` → `ignore_changes` on those rules.
- Instance-profile tags are not stored → `ignore_changes = [tags_all]`.

## Security-group enforcement

`FLOCI_NETWORK_SECURITY_GROUP_ENFORCEMENT_ENABLED=true` is set in docker-compose. Its effect on ALB → instance traffic is recorded in the README after the apply.
