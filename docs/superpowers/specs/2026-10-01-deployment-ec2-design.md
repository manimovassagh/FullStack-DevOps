# Deployment Stage 1 — Classic EC2 on Floci — Design

**Date:** 2026-10-01
**Goal:** Learn classic AWS deployment with Terraform by deploying Plant Parent to a textbook 3-tier VPC (public ALB, private EC2 app tier, private RDS tier) — entirely locally on [Floci](https://floci.io). Nothing is deployed to real AWS.

This is the first of several deployment stages that live side by side under `deployment/`:

| Folder | Stage | Status |
|---|---|---|
| `deployment/01-ec2/` | VPC + ALB + EC2 (systemd, no Docker on instances) + RDS + S3 | this spec |
| `deployment/02-ecs/` | Elastic Container Service | later, own spec |
| `deployment/03-eks/` | Elastic Kubernetes Service (or Fargate/others) | later, own spec |

Each stage is self-contained: its own Terraform root, state, Makefile and README, and can be applied/destroyed independently. A stage starts only after the previous one works end to end. This supersedes the `infra/` folder mentioned in the original design spec.

## What the user asked for vs. assumptions

- **Asked:** a `deployment/` folder with one subfolder per deployment type; stage 1 = VPC with public and private subnets, EC2 for frontend and backend, S3 bucket, load balancer, "as normally done in AWS"; classic deployment without Docker on the instances (option A); local only.
- **Assumed:** Postgres is RDS in private DB subnets; folder names are numbered to show the learning order.

## Architecture

```
                 Browser ─► ALB :80  (public subnets a/b)
                              ├─ /api/*  ─► TG "backend"  :8080  health GET /api/health
                              └─ /*      ─► TG "frontend" :80    health GET /
 private app subnets a/b:  EC2 "frontend" — nginx serving the React build
                           EC2 "backend"  — Go binary as systemd service "plant-api"
 private db subnets a/b:   RDS PostgreSQL 16 ◄── backend only
 S3:      plant-ec2-media (user photos/files) · plant-ec2-artifacts (build outputs)
 Secrets: Secrets Manager "plant-ec2/db" (DB credentials)
```

The ALB does the path routing, as on real AWS. The frontend calls relative `/api/...` URLs, so no app code changes are needed and nginx on the frontend instance only serves static files (with SPA fallback to `index.html`).

## Network

- VPC `10.0.0.0/16`, two AZs (`us-east-1a`, `us-east-1b`).
- Subnets: public `10.0.0.0/24`, `10.0.1.0/24`; private-app `10.0.10.0/24`, `10.0.11.0/24`; private-db `10.0.20.0/24`, `10.0.21.0/24`.
- Internet Gateway + public route table (`0.0.0.0/0 → igw`); one NAT Gateway (+ EIP) in public-a + private route table (`0.0.0.0/0 → nat`) for app and db subnets.
- Security groups (rules reference SGs, not CIDRs, except the ALB):
  - `alb`: ingress 80 from `0.0.0.0/0`; egress all.
  - `frontend`: ingress 80 from `alb`; egress all.
  - `backend`: ingress 8080 from `alb`; egress all.
  - `db`: ingress 5432 from `backend`; egress none needed.
  - SSH (22) to the app instances from `var.ssh_cidr` (default `0.0.0.0/0`, acceptable because everything is local; on real AWS this would be a bastion or SSM). Used for debugging via Floci's mapped SSH port.

**Floci fidelity:** IGW, NAT and route tables are stored as metadata only (every subnet in a VPC is one Docker network, and outbound internet works through Docker regardless). They are still written exactly as for real AWS. Security groups are **enforced** by setting `FLOCI_NETWORK_SECURITY_GROUP_ENFORCEMENT_ENABLED=true`, so wrong rules really break connectivity. Fallback if enforcement does not work on the local Docker (Rancher Desktop): leave it off, keep the rules as documentation, and note this in the stage README.

## Compute

Two `aws_instance` resources (one frontend, one backend, both in private-app subnet a), AMI `ami-ubuntu2404-cloud` (Floci's systemd + cloud-init Ubuntu image, arm64), instance type `t4g.micro` (arm64, matching the local Docker), a generated key pair (`tls_private_key` → `aws_key_pair`, private key written to a git-ignored file) and `user_data_replace_on_change = true`.

Fallback if the systemd image does not boot locally: `ami-ubuntu2404` with UserData starting the processes directly (`nohup`/nginx daemon) instead of via systemd units. The README records which variant is in use.

**Backend UserData (bash):**
1. Install `curl`, `unzip`, `jq` and AWS CLI v2 (official zip; Ubuntu 24.04 apt has no awscli). Shared bootstrap with the frontend.
2. Download `backend/plant-api` from `plant-ec2-artifacts` to `/opt/plant/plant-api` using the instance profile.
3. Read secret `plant-ec2/db` from Secrets Manager; write `/etc/plant/env` (mode 0600) with `PORT=8080`, `DATABASE_URL`, `S3_BUCKET=plant-ec2-media`, `AWS_REGION`, `AWS_ENDPOINT_URL`, `AWS_EC2_METADATA_SERVICE_ENDPOINT` (systemd services do not inherit the container env, so the Go SDK needs IMDS spelled out).
4. Install the systemd unit `plant-api.service` (`EnvironmentFile=/etc/plant/env`, `Restart=always`, runs as user `plant`), then `systemctl enable --now plant-api`.

The app applies its migrations at startup, so no separate migration step is needed.

**Frontend UserData (bash):** install nginx, download `frontend/dist.tar.gz`, extract to `/var/www/plant`, write a server block (`try_files $uri /index.html`) and restart nginx.

`AWS_ENDPOINT_URL` is the Floci endpoint as seen from inside an instance container. Floci injects it into the instance environment; the plan's probe task confirms the exact value and how UserData reads it. On real AWS this variable would simply be omitted.

## Artifacts and redeploys

- `make artifacts` builds `build/plant-api` (`CGO_ENABLED=0 GOOS=linux GOARCH=<docker arch> -trimpath`) and `build/dist.tar.gz` from `frontend/dist`.
- Terraform uploads them with `aws_s3_object` (`source_hash` = the content hash below).
- Terraform computes a content hash (backend: `filemd5` of the binary; frontend: hash over every file in `frontend/dist`, because tarballs embed mtimes) and embeds it in each instance's UserData as a comment. Changed content → changed UserData → that instance is replaced. Unchanged content → `terraform plan` shows no changes.

## Data, secrets and IAM

- RDS: `aws_db_instance` PostgreSQL 16, `db.t4g.micro`, db name `plant`, user `plant`, `aws_db_subnet_group` over the two private-db subnets, SG `db`, `skip_final_snapshot = true`.
- Password: `random_password` → `aws_secretsmanager_secret` `plant-ec2/db` holding JSON `{username, password, host, port, dbname}`.
- S3: `plant-ec2-media` and `plant-ec2-artifacts`, with public access blocked and `force_destroy` (local learning stack). Names differ from the local-dev bucket `plant-media`, which lives in the same Floci.
- IAM roles + instance profiles:
  - backend: `s3:GetObject` on `plant-ec2-artifacts/backend/*`; `s3:GetObject/PutObject/DeleteObject` on `plant-ec2-media/*` plus `s3:ListBucket` on `plant-ec2-media`; `secretsmanager:GetSecretValue` on `plant-ec2/db`.
  - frontend: `s3:GetObject` on `plant-ec2-artifacts/frontend/*`.

## Terraform layout

```
deployment/
├── README.md               index of stages, shared prerequisites
└── 01-ec2/
    ├── README.md           how to run, what each piece teaches, Floci caveats
    ├── Makefile            artifacts, init, plan, apply, smoke, ssh-backend, ssh-frontend, destroy
    ├── providers.tf        aws provider → Floci endpoints, test creds, skip_* flags, s3_use_path_style
    ├── variables.tf / outputs.tf   (outputs: alb_dns_name, alb_url, instance ids, ssh commands)
    ├── network.tf          vpc, subnets, igw, nat, route tables
    ├── security.tf         security groups
    ├── iam.tf              roles, policies, instance profiles
    ├── storage.tf          s3 buckets + artifact objects
    ├── database.tf         rds, subnet group, secret
    ├── compute.tf          key pair, instances (AMI id is a variable)
    ├── alb.tf              alb, target groups, attachments, listener, /api/* rule
    ├── templates/backend-user-data.sh.tftpl, frontend-user-data.sh.tftpl, nginx.conf
    └── scripts/smoke.sh
```

Plain resources, no modules. Local state (`terraform.tfstate`, git-ignored). Provider versions pinned in `.terraform.lock.hcl` (committed).

## Changes outside `deployment/`

- `docker-compose.yml`: mount `/var/run/docker.sock` into `floci`; set `FLOCI_NETWORK_SECURITY_GROUP_ENFORCEMENT_ENABLED=true`; publish the ALB listener port to the host (exact mapping decided by the probe task). The existing local dev flow (`make up`, `make test`) must keep working.
- `.gitignore`: `deployment/**/build/`, `.terraform/`, `*.tfstate*`, generated SSH keys.
- Root `README.md`: replace the `infra/` line with a pointer to `deployment/`.
- No application code changes.

## Risks — probed first, before writing Terraform

1. The `ami-ubuntu2404-cloud` (systemd) instance boots under Rancher Desktop → else use the fallback image.
2. How an ALB listener on Floci is reached from the Mac (port publishing on the Floci container) → decides the compose port mapping and the `alb_url` output.
3. From inside an instance: the Floci AWS endpoint (S3, Secrets Manager) and the RDS endpoint are reachable → decides how `AWS_ENDPOINT_URL` and `DATABASE_URL` host are set.
4. SG enforcement works on this Docker → else disable it (documented).

The probe is a throwaway AWS CLI script against Floci; findings go into the stage README.

## Testing / done criteria

- `terraform fmt -check` and `terraform validate` pass.
- `make apply` from a clean Floci succeeds; target health of both target groups becomes `healthy`.
- `make smoke` passes against the ALB URL: health → create plant → upload photo → download (bytes match) → water → list shows cover → delete → 404, S3 prefix empty.
- The app UI loads from the ALB URL in a browser.
- SG experiment: the probe records which paths Floci enforces (ALB → instance, instance → RDS proxy); the README documents one experiment that visibly breaks traffic when a rule is removed.
- `make destroy` leaves no instances or RDS containers running.
- Root `make test` still passes.

## Out of scope (for this stage)

Auto Scaling Groups / launch templates, HTTPS/ACM, Route 53, CloudWatch agent, bastion host, multiple instances per tier, remote Terraform state, CI/CD. Candidates for small follow-ups once stage 1 works.
