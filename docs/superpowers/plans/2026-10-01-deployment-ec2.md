# Deployment Stage 1 (Classic EC2 on Floci) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Plant Parent with Terraform to a classic 3-tier AWS layout (public ALB → private EC2 frontend/backend → private RDS, plus S3 and Secrets Manager) running locally on Floci, in `deployment/01-ec2/`.

**Architecture:** One self-contained Terraform root per deployment stage under `deployment/`. Build outputs (Go binary, React `dist`) are uploaded to an S3 artifacts bucket; EC2 instances (Floci runs each one as a real Docker container from an Ubuntu 24.04 systemd image) pull them at boot via their IAM instance profile, run the API as a systemd service and the UI through nginx. The ALB routes `/api/*` to the backend and everything else to the frontend.

**Tech Stack:** Terraform 1.14 (hashicorp/aws ~> 6.0, random, tls, local), Floci (`floci/floci:latest`) via Docker Compose, Ubuntu 24.04 cloud image (`ami-ubuntu2404-cloud`), systemd, nginx, AWS CLI v2, Go 1.26, Node 25 / Vite.

**Spec:** `docs/superpowers/specs/2026-10-01-deployment-ec2-design.md`

## Global Constraints

- Everything runs locally against Floci at `http://localhost:4566`; credentials `test`/`test`, region `us-east-1`. Never configure a real AWS account.
- Terraform only (no CDK, no CloudFormation, no click-ops). Plain resources, no modules. Local state, git-ignored. `.terraform.lock.hcl` is committed.
- No application code changes in `backend/` or `frontend/`.
- Resource names are prefixed `plant-ec2` (buckets `plant-ec2-media`, `plant-ec2-artifacts`; secret `plant-ec2/db`). The local-dev bucket `plant-media` must not be touched.
- VPC `10.0.0.0/16`; AZs `us-east-1a`, `us-east-1b`; subnets public `10.0.0.0/24`,`10.0.1.0/24`; app `10.0.10.0/24`,`10.0.11.0/24`; db `10.0.20.0/24`,`10.0.21.0/24`.
- AMI `ami-ubuntu2404-cloud`, instance type `t4g.micro` (local Docker is arm64/aarch64).
- Root `make up` / `make test` must keep working after every task.
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Re-running `make apply` with unchanged code must be a no-op (no instance replacement) — pinned in Task 8 Step 2 with `terraform plan -detailed-exitcode`.
2. A browser deep link (`/plants/<id>`) through the ALB must return the SPA, not a 404 — pinned in `smoke.sh` (Task 2) check "spa deep link".
3. A multi-MB photo upload through the ALB must work (ALB → backend body forwarding, well under the 10 MiB app limit) — pinned in `smoke.sh` with a 2 MiB upload.
4. If the API process dies, systemd brings it back — pinned in Task 6 Step 7 (kill + health check).
5. Floci restarts wipe its in-memory state while `terraform.tfstate` remains — pinned by `make forget` (Task 2) and the README recovery section (Task 8).

## File Structure

```
docker-compose.yml                         MODIFY  docker.sock, SG enforcement, ALB port publishing
.gitignore                                 MODIFY  deployment build/state/keys
README.md                                  MODIFY  point at deployment/
deployment/README.md                       CREATE  stage index + shared prerequisites
deployment/01-ec2/
  README.md                                CREATE  run guide, what each file teaches, Floci caveats, experiments
  FLOCI-NOTES.md                           CREATE  probe findings (Task 1) — facts later tasks depend on
  Makefile                                 CREATE  artifacts/init/plan/apply/smoke/health/ssh/destroy/forget
  versions.tf                              CREATE  terraform + provider versions
  providers.tf                             CREATE  aws provider pointed at Floci
  variables.tf                             CREATE  all inputs (probe-dependent ones included)
  outputs.tf                               CREATE  app_url, ids, bucket names
  network.tf                               CREATE  vpc, subnets, igw, nat, route tables
  security.tf                              CREATE  security groups + rules
  storage.tf                               CREATE  buckets + artifact objects + content hashes
  iam.tf                                   CREATE  roles, policies, instance profiles
  database.tf                              CREATE  db subnet group, rds, secret
  compute.tf                               CREATE  key pair, backend + frontend instances
  alb.tf                                   CREATE  alb, target groups, listener, /api/* rule
  templates/bootstrap.sh                   CREATE  shared UserData prelude (packages, AWS CLI, helpers)
  templates/backend.sh.tftpl               CREATE  backend UserData body
  templates/frontend.sh.tftpl              CREATE  frontend UserData body
  scripts/smoke.sh                         CREATE  end-to-end test through the ALB
  scripts/ssh.sh                           CREATE  ssh into an instance via Floci's mapped port
```

---

### Task 1: Floci prerequisites + risk probe

Goal: enable Docker-backed EC2 in Floci, then answer the four spec risks with a throwaway script **before** any Terraform exists. Record facts in `FLOCI-NOTES.md`; later tasks read them.

**Files:**
- Modify: `docker-compose.yml`
- Create: `deployment/README.md`, `deployment/01-ec2/FLOCI-NOTES.md`
- Throwaway (scratchpad, not committed): `probe.sh`

**Interfaces:**
- Produces (in `FLOCI-NOTES.md`, consumed by Tasks 4–7): values for `alb_listener_port`, `alb_host_port`, `instance_aws_endpoint` (Floci URL from inside an instance, or "injected"), `db_host_override`/`db_port_override` (if the RDS endpoint is not reachable as advertised), `ami_id` (cloud vs fallback), whether SG enforcement stays on and which SG source makes ALB → instance traffic pass, and how to find an instance's Docker container (name pattern).

- [ ] **Step 1: Update `docker-compose.yml`** — replace the `floci` service with:

```yaml
  # Local AWS emulator. The Docker socket lets Floci run EC2 instances, RDS and
  # ECS tasks as real containers (deployment/ stages).
  floci:
    image: floci/floci:latest
    ports:
      - "4566:4566"
      - "8088:80"   # ALB listener of deployment/01-ec2 → http://localhost:8088
    environment:
      FLOCI_NETWORK_SECURITY_GROUP_ENFORCEMENT_ENABLED: "true"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

- [ ] **Step 2: Restart and confirm local dev still works**

Run: `docker compose up -d --wait floci && make bucket && make test`
Expected: tests PASS as before (Floci restart wiped the old bucket; `make bucket` recreates it).

- [ ] **Step 3: Write the probe** to `$SCRATCH/probe.sh` (scratchpad dir; not committed):

```bash
#!/usr/bin/env bash
# Throwaway: answers the spec's four Floci risks. Prints facts; cleans up after itself.
set -uo pipefail
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
A="aws --endpoint-url http://localhost:4566"
say() { printf '\n=== %s\n' "$*"; }

VPC=$($A ec2 create-vpc --cidr-block 10.99.0.0/16 --query Vpc.VpcId --output text)
SUB=$($A ec2 create-subnet --vpc-id $VPC --cidr-block 10.99.1.0/24 --availability-zone us-east-1a --query Subnet.SubnetId --output text)
SUB2=$($A ec2 create-subnet --vpc-id $VPC --cidr-block 10.99.2.0/24 --availability-zone us-east-1b --query Subnet.SubnetId --output text)
SG_ALB=$($A ec2 create-security-group --vpc-id $VPC --group-name probe-alb --description probe --query GroupId --output text)
SG_I=$($A ec2 create-security-group --vpc-id $VPC --group-name probe-inst --description probe --query GroupId --output text)
$A ec2 authorize-security-group-ingress --group-id $SG_ALB --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
$A ec2 authorize-security-group-ingress --group-id $SG_I --protocol tcp --port 80 --source-group $SG_ALB >/dev/null

UD=$(base64 <<'EOF'
#!/bin/bash
env | sort > /root/probe-env.txt
mkdir -p /srv && echo probe-ok > /srv/index.html
cd /srv && nohup python3 -m http.server 80 >/var/log/probe-http.log 2>&1 &
EOF
)
I=$($A ec2 run-instances --image-id ami-ubuntu2404-cloud --instance-type t4g.micro --subnet-id $SUB \
  --security-group-ids $SG_I --user-data "$UD" --query 'Instances[0].InstanceId' --output text)
say "instance $I"; sleep 25
C=$(docker ps --format '{{.ID}} {{.Names}}' | grep -i "$I" | awk '{print $1}')
say "Q-container: docker container for $I"; docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}' | grep -i "$I"
say "Q1 systemd state"; docker exec $C systemctl is-system-running || true
say "Q3a env inside instance (AWS_*)"; docker exec $C grep '^AWS_' /root/probe-env.txt
EP=$(docker exec $C sh -c "grep '^AWS_ENDPOINT_URL=' /root/probe-env.txt | cut -d= -f2-")
say "Q3b Floci endpoint reachable from instance ($EP)"; docker exec $C curl -s -o /dev/null -w '%{http_code}\n' "$EP" || echo UNREACHABLE
say "Q3c IMDS from instance"; docker exec $C sh -c 'curl -s "$(grep ^AWS_EC2_METADATA_SERVICE_ENDPOINT= /root/probe-env.txt | cut -d= -f2-)/latest/meta-data/instance-id"; echo'

$A rds create-db-subnet-group --db-subnet-group-name probe --db-subnet-group-description probe --subnet-ids $SUB $SUB2 >/dev/null
$A rds create-db-instance --db-instance-identifier probe-db --engine postgres --engine-version 16 --db-instance-class db.t4g.micro \
  --master-username plant --master-user-password plantplant1 --allocated-storage 20 --db-subnet-group-name probe >/dev/null
for i in $(seq 1 60); do S=$($A rds describe-db-instances --db-instance-identifier probe-db --query 'DBInstances[0].DBInstanceStatus' --output text); [ "$S" = available ] && break; sleep 2; done
EPA=$($A rds describe-db-instances --db-instance-identifier probe-db --query 'DBInstances[0].Endpoint.[Address,Port]' --output text)
say "Q3d RDS endpoint advertised: $EPA"
read -r H P <<<"$EPA"
docker exec $C bash -c "timeout 3 bash -c '</dev/tcp/$H/$P' && echo RDS-REACHABLE-AS-ADVERTISED || echo RDS-NOT-REACHABLE-AS-ADVERTISED"
docker exec $C bash -c "getent hosts floci; timeout 3 bash -c '</dev/tcp/floci/$P' && echo RDS-REACHABLE-VIA-floci || echo no-via-floci"

LB=$($A elbv2 create-load-balancer --name probe-alb --type application --subnets $SUB $SUB2 --security-groups $SG_ALB --query 'LoadBalancers[0].LoadBalancerArn' --output text)
TG=$($A elbv2 create-target-group --name probe-tg --protocol HTTP --port 80 --vpc-id $VPC --target-type instance --health-check-path / --query 'TargetGroups[0].TargetGroupArn' --output text)
$A elbv2 register-targets --target-group-arn $TG --targets Id=$I,Port=80
$A elbv2 create-listener --load-balancer-arn $LB --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=$TG >/dev/null
sleep 15
say "Q2 target health"; $A elbv2 describe-target-health --target-group-arn $TG --query 'TargetHealthDescriptions[0].TargetHealth' --output json
say "Q2+Q4 ALB from Mac via published port 8088 (SG source = alb SG, enforcement on)"; curl -s -m 5 localhost:8088 || echo ALB-UNREACHABLE

say "cleanup"
$A elbv2 delete-load-balancer --load-balancer-arn $LB; sleep 2; $A elbv2 delete-target-group --target-group-arn $TG
$A ec2 terminate-instances --instance-ids $I >/dev/null
$A rds delete-db-instance --db-instance-identifier probe-db --skip-final-snapshot >/dev/null
sleep 5; $A rds delete-db-subnet-group --db-subnet-group-name probe
$A ec2 delete-security-group --group-id $SG_I; $A ec2 delete-security-group --group-id $SG_ALB
$A ec2 delete-subnet --subnet-id $SUB; $A ec2 delete-subnet --subnet-id $SUB2; $A ec2 delete-vpc --vpc-id $VPC
```

- [ ] **Step 4: Run it** — `bash $SCRATCH/probe.sh 2>&1 | tee $SCRATCH/probe.log`; also `docker compose logs floci | tail -100 > $SCRATCH/floci.log` for error messages.

- [ ] **Step 5: Resolve each question; apply the matching fallback, re-run until every answer is known.**

| Question | Good outcome | If not |
|---|---|---|
| Q1 systemd | `running` or `degraded` | Retry with `--image-id ami-ubuntu2404`; set `ami_id = "ami-ubuntu2404"` and `use_systemd = false` (Task 6 has the non-systemd branch). |
| Q2 ALB reachable from Mac | `probe-ok` from `localhost:8088` | Check `floci.log` for the listener bind; try listener port 8088 with compose `8088:8088`; record the working `alb_listener_port`/`alb_host_port`. |
| Q3a/b Floci endpoint | `AWS_ENDPOINT_URL` present, curl returns any HTTP code | Find Floci's IP on the VPC network (`docker network inspect` on the VPC's network) and record `instance_aws_endpoint = "http://<ip>:4566"`. |
| Q3c IMDS | prints the instance id | Record; the backend can't get credentials without it → fallback: write static `test` creds into `/etc/plant/env` (documented as Floci-only). |
| Q3d RDS | `RDS-REACHABLE-AS-ADVERTISED` | If reachable via `floci`, or via Floci's VPC-network IP, record `db_host_override` (and `db_port_override` if needed). |
| Q4 SG enforcement | ALB request succeeds with the SG-referenced rule | If ALB traffic is blocked: set `alb_source_cidr` (Floci's address range on the VPC network) and add CIDR rules (Task 3 has the variable). If enforcement breaks instance boot entirely: set it to `"false"` in compose and record that SGs are metadata-only. |

- [ ] **Step 6: Write `deployment/01-ec2/FLOCI-NOTES.md`** — one section per question: the command, the observed output (trimmed), and the resulting value. End with a "Values for terraform.tfvars" block, e.g.:

```hcl
ami_id                = "ami-ubuntu2404-cloud"
alb_listener_port     = 80
alb_host_port         = 8088
instance_aws_endpoint = ""      # "" = use the AWS_ENDPOINT_URL Floci injects
db_host_override      = ""
db_port_override      = 0
alb_source_cidr       = ""      # "" = SG-to-SG rules work under enforcement
```

- [ ] **Step 7: Write `deployment/README.md`**

```markdown
# Deployments

Plant Parent deployed several ways, all with Terraform, all **locally on Floci** (no real AWS).
Each folder is a self-contained Terraform root: own state, own Makefile, `make apply` / `make destroy` independently.

| Stage | Folder | What you learn |
|---|---|---|
| 1 | [01-ec2](01-ec2/) | VPC with public/private subnets, ALB, EC2 + UserData + systemd, RDS, S3, IAM instance profiles, Secrets Manager |
| 2 | 02-ecs (planned) | Containers on ECS: ECR, task definitions, services |
| 3 | 03-eks (planned) | Kubernetes on EKS |

## Prerequisites

Docker, Terraform ≥ 1.14, AWS CLI v2, Go 1.26+, Node 22+. From the repo root: `make up` (starts Floci with the Docker socket mounted).
```

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml deployment/README.md deployment/01-ec2/FLOCI-NOTES.md
git commit -m "chore(deployment): enable docker-backed Floci services; record EC2/ALB/RDS probe findings"
```

---

### Task 2: Stage scaffold — provider, variables, Makefile, smoke test

**Files:**
- Create: `deployment/01-ec2/{versions.tf,providers.tf,variables.tf,outputs.tf,Makefile}`, `deployment/01-ec2/scripts/{smoke.sh,ssh.sh}`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `FLOCI-NOTES.md` values (defaults of the probe-dependent variables).
- Produces: variables `region, floci_endpoint, name, ami_id, instance_type, use_systemd, alb_listener_port, alb_host_port, instance_aws_endpoint, db_host_override, db_port_override, alb_source_cidr, ssh_cidr, build_dir, frontend_dist_dir`; `local.name`; Makefile targets `artifacts init plan apply smoke health ssh-backend ssh-frontend destroy forget`; `scripts/smoke.sh <base_url> <media_bucket>`; `scripts/ssh.sh <instance_id> [cmd...]`. Outputs added later must keep the names `app_url`, `media_bucket`, `backend_instance_id`, `frontend_instance_id`, `backend_target_group_arn`, `frontend_target_group_arn`.

- [ ] **Step 1: `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.14"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
    tls    = { source = "hashicorp/tls", version = "~> 4.1" }
    local  = { source = "hashicorp/local", version = "~> 2.5" }
  }
}
```

- [ ] **Step 2: `providers.tf`**

```hcl
# Every AWS API call goes to Floci. On real AWS you would delete the endpoints
# block, the static keys and the skip_* flags — the resources stay the same.
provider "aws" {
  region     = var.region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    ec2            = var.floci_endpoint
    elbv2          = var.floci_endpoint
    iam            = var.floci_endpoint
    rds            = var.floci_endpoint
    s3             = var.floci_endpoint
    secretsmanager = var.floci_endpoint
    sts            = var.floci_endpoint
  }

  default_tags {
    tags = { Project = "plant-parent", Stage = "01-ec2" }
  }
}
```

- [ ] **Step 3: `variables.tf`** (set defaults of the probe-dependent variables to the values in `FLOCI-NOTES.md`)

```hcl
variable "region" {
  type    = string
  default = "us-east-1"
}

variable "floci_endpoint" {
  description = "Floci URL as seen from this machine (Terraform, AWS CLI)."
  type        = string
  default     = "http://localhost:4566"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-ec2"
}

variable "ami_id" {
  description = "Floci AMI alias. ami-ubuntu2404-cloud boots systemd; ami-ubuntu2404 is the fallback."
  type        = string
  default     = "ami-ubuntu2404-cloud"
}

variable "use_systemd" {
  description = "false only with the fallback AMI: UserData then starts processes directly."
  type        = bool
  default     = true
}

variable "instance_type" {
  type    = string
  default = "t4g.micro"
}

variable "alb_listener_port" {
  type    = number
  default = 80
}

variable "alb_host_port" {
  description = "Host port docker-compose publishes for the ALB listener."
  type        = number
  default     = 8088
}

variable "instance_aws_endpoint" {
  description = "Floci URL as seen from inside an instance. Empty = use the AWS_ENDPOINT_URL Floci injects."
  type        = string
  default     = ""
}

variable "db_host_override" {
  description = "Empty = use the RDS address Floci advertises. Set when instances must reach RDS another way (see FLOCI-NOTES.md)."
  type        = string
  default     = ""
}

variable "db_port_override" {
  type    = number
  default = 0
}

variable "alb_source_cidr" {
  description = "Empty = app SGs allow the ALB SG (real-AWS style). Set to a CIDR if Floci's ALB traffic does not carry the ALB SG identity."
  type        = string
  default     = ""
}

variable "ssh_cidr" {
  description = "Who may SSH to app instances. Wide open is fine locally; on real AWS use a bastion or SSM."
  type        = string
  default     = "0.0.0.0/0"
}

variable "build_dir" {
  type    = string
  default = "build"
}

variable "frontend_dist_dir" {
  type    = string
  default = "../../frontend/dist"
}
```

- [ ] **Step 4: `outputs.tf`** (outputs for resources created later are added by those tasks; start with this)

```hcl
output "app_url" {
  description = "Open this in the browser. The ALB DNS name does not resolve locally, so we use the published port."
  value       = "http://localhost:${var.alb_host_port}"
}
```

- [ ] **Step 5: `scripts/smoke.sh`** (this is the stage's acceptance test; it fails until Task 7)

```bash
#!/usr/bin/env bash
# End-to-end check through the ALB: the same journey a user takes in the browser.
# Usage: smoke.sh <base_url> <media_bucket>
set -euo pipefail
BASE=${1:?base url}; BUCKET=${2:?media bucket}
API="$BASE/api"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
AWS=(aws --endpoint-url "${FLOCI_ENDPOINT:-http://localhost:4566}" --region us-east-1)
pass() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; exit 1; }
json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

curl -sf "$API/health" | grep -q '"ok"' && pass "health" || fail "health ($API/health)"
curl -sf "$BASE/" | grep -qi '<div id="root">' && pass "frontend index" || fail "frontend index"

P=$(curl -sf -X POST "$API/plants" -H 'content-type: application/json' \
  -d '{"name":"Smoke Monstera","species":"Monstera deliciosa","water_every_days":7}') || fail "create plant"
ID=$(echo "$P" | json '["id"]'); pass "create plant $ID"

curl -sf "$BASE/plants/$ID" | grep -qi '<div id="root">' && pass "spa deep link" || fail "spa deep link /plants/$ID"

{ printf '\x89PNG\r\n\x1a\n'; head -c $((2*1024*1024)) /dev/urandom; } > "$TMP/big.png"
M=$(curl -sf -X POST "$API/plants/$ID/media" -F "file=@$TMP/big.png;type=image/png" -F caption=smoke) || fail "upload 2 MiB photo"
MID=$(echo "$M" | json '["id"]'); pass "upload 2 MiB photo"

curl -sf -o "$TMP/dl.png" "$API/media/$MID" || fail "download"
cmp -s "$TMP/big.png" "$TMP/dl.png" && pass "download bytes match" || fail "download bytes differ"
"${AWS[@]}" s3 ls "s3://$BUCKET/plants/$ID/" | grep -q "$MID" && pass "object in s3://$BUCKET" || fail "object missing in S3"

curl -sf -X POST "$API/plants/$ID/water" >/dev/null && pass "water" || fail "water"
[ "$(curl -sf "$API/plants/$ID" | json '["waterings"].__len__()')" = 1 ] && pass "watering recorded" || fail "watering recorded"
[ "$(curl -sf "$API/plants" | python3 -c "import sys,json;print([p['cover_media_id'] for p in json.load(sys.stdin) if p['id']=='$ID'][0])")" = "$MID" ] \
  && pass "list shows cover photo" || fail "list shows cover photo"

[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/plants/$ID")" = 204 ] && pass "delete" || fail "delete"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API/plants/$ID")" = 404 ] && pass "gone after delete" || fail "still there after delete"
[ -z "$("${AWS[@]}" s3 ls "s3://$BUCKET/plants/$ID/" || true)" ] && pass "S3 prefix empty" || fail "S3 objects left behind"
echo "SMOKE PASSED"
```

- [ ] **Step 6: `scripts/ssh.sh`** (use the container-lookup pattern recorded in `FLOCI-NOTES.md`; below assumes the container name contains the instance id)

```bash
#!/usr/bin/env bash
# SSH into a Floci EC2 instance through the host port Floci maps to its port 22.
# Usage: ssh.sh <instance_id> [remote command...]
set -euo pipefail
ID=${1:?instance id}; shift
DIR=$(cd "$(dirname "$0")/.." && pwd)
C=$(docker ps --format '{{.ID}} {{.Names}}' | awk -v id="$ID" 'index($2, id) {print $1; exit}')
[ -n "$C" ] || { echo "no running container for $ID" >&2; exit 1; }
PORT=$(docker port "$C" 22 | head -1 | awk -F: '{print $NF}')
exec ssh -i "$DIR/build/ssh/id_rsa" -p "$PORT" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@localhost "$@"
```

- [ ] **Step 7: `Makefile`**

```make
# Stage 1: classic EC2 deployment on Floci. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../..)
BUILD := build

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4566
AWS   := aws --endpoint-url $(FLOCI)

# Instances are containers on the local Docker, so build for its CPU.
DOCKER_ARCH := $(shell docker info --format '{{.Architecture}}' 2>/dev/null)
GOARCH      := $(if $(filter aarch64 arm64,$(DOCKER_ARCH)),arm64,amd64)

.PHONY: artifacts init plan apply smoke health ssh-backend ssh-frontend destroy forget

artifacts: ## build the Go binary and the React bundle that instances download from S3
	mkdir -p $(BUILD)
	cd $(ROOT)/backend && CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) \
		go build -trimpath -ldflags='-s -w' -o $(CURDIR)/$(BUILD)/plant-api ./cmd/server
	cd $(ROOT)/frontend && npm ci --silent && npm run build
	COPYFILE_DISABLE=1 tar -czf $(BUILD)/dist.tar.gz -C $(ROOT)/frontend/dist .

init:
	terraform init

plan: artifacts
	terraform plan

apply: artifacts
	terraform apply -auto-approve

smoke:
	./scripts/smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"

health: ## target health of both target groups
	@for tg in backend frontend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -raw $${tg}_target_group_arn)" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

ssh-backend:
	./scripts/ssh.sh "$$(terraform output -raw backend_instance_id)"

ssh-frontend:
	./scripts/ssh.sh "$$(terraform output -raw frontend_instance_id)"

destroy:
	terraform destroy -auto-approve

forget: ## Floci was restarted and lost everything: drop the stale state so the next apply starts clean
	rm -f terraform.tfstate terraform.tfstate.backup
```

- [ ] **Step 8: `.gitignore`** — replace the `# terraform` block with:

```gitignore
# terraform / deployments
.terraform/
*.tfstate
*.tfstate.*
deployment/**/build/
```

- [ ] **Step 9: Initialise and validate**

Run: `chmod +x deployment/01-ec2/scripts/*.sh && cd deployment/01-ec2 && terraform init && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 10: Confirm the acceptance test fails for the right reason**

Run: `cd deployment/01-ec2 && ./scripts/smoke.sh http://localhost:8088 plant-ec2-media`
Expected: `FAIL health (http://localhost:8088/api/health)` (nothing deployed yet).

- [ ] **Step 11: Commit**

```bash
git add .gitignore deployment/01-ec2/{versions.tf,providers.tf,variables.tf,outputs.tf,Makefile,.terraform.lock.hcl,scripts}
git commit -m "feat(deployment): scaffold EC2 stage with Floci provider, Makefile and smoke test"
```

---

### Task 3: Network and security groups

**Files:**
- Create: `deployment/01-ec2/network.tf`, `deployment/01-ec2/security.tf`

**Interfaces:**
- Produces: `aws_vpc.main`, `aws_subnet.public["a"|"b"]`, `aws_subnet.app["a"|"b"]`, `aws_subnet.db["a"|"b"]`, `aws_security_group.{alb,frontend,backend,db}`.

- [ ] **Step 1: `network.tf`**

```hcl
locals {
  # One entry per AZ; `n` picks the third octet offset for each tier.
  azs = {
    a = { az = "${var.region}a", n = 0 }
    b = { az = "${var.region}b", n = 1 }
  }
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

# Public tier: only the ALB and the NAT gateway live here.
resource "aws_subnet" "public" {
  for_each                = local.azs
  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.value.az
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, 0 + each.value.n)
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name}-public-${each.key}", Tier = "public" }
}

# Private app tier: EC2 instances, reachable only through the ALB.
resource "aws_subnet" "app" {
  for_each          = local.azs
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value.az
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + each.value.n)
  tags              = { Name = "${var.name}-app-${each.key}", Tier = "app" }
}

# Private data tier: RDS only.
resource "aws_subnet" "db" {
  for_each          = local.azs
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value.az
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 20 + each.value.n)
  tags              = { Name = "${var.name}-db-${each.key}", Tier = "db" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.name }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# Private instances reach the internet (apt, AWS CLI download) through NAT.
# On Floci this is metadata only — Docker provides outbound access anyway.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.name}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public["a"].id
  tags          = { Name = var.name }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${var.name}-private" }
}

resource "aws_route_table_association" "app" {
  for_each       = aws_subnet.app
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "db" {
  for_each       = aws_subnet.db
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}
```

- [ ] **Step 2: `security.tf`**

```hcl
# Chain: internet → alb → frontend/backend → db. Each tier only accepts the tier in front of it.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP into the load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "frontend" {
  name        = "${var.name}-frontend"
  description = "nginx, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "backend" {
  name        = "${var.name}-backend"
  description = "Go API, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres, only from the backend"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = var.alb_listener_port
  to_port           = var.alb_listener_port
}

locals {
  app_tiers = {
    frontend = { sg = aws_security_group.frontend.id, port = 80 }
    backend  = { sg = aws_security_group.backend.id, port = 8080 }
  }
}

# Real-AWS style: allow traffic whose source is the ALB's security group.
resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  for_each                     = var.alb_source_cidr == "" ? local.app_tiers : {}
  security_group_id            = each.value.sg
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

# Floci fallback (see FLOCI-NOTES.md): its ALB connects from its own address.
resource "aws_vpc_security_group_ingress_rule" "from_alb_cidr" {
  for_each          = var.alb_source_cidr == "" ? {} : local.app_tiers
  security_group_id = each.value.sg
  cidr_ipv4         = var.alb_source_cidr
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each          = local.app_tiers
  security_group_id = each.value.sg
  cidr_ipv4         = var.ssh_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "db_from_backend" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.backend.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "all" {
  for_each = {
    alb      = aws_security_group.alb.id
    frontend = aws_security_group.frontend.id
    backend  = aws_security_group.backend.id
  }
  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
```

- [ ] **Step 3: Validate and apply**

Run: `cd deployment/01-ec2 && terraform fmt -check && terraform validate && terraform apply -auto-approve`
Expected: `Apply complete! Resources: 2x added` (VPC, 6 subnets, IGW, EIP, NAT, 2 route tables, 6 associations, 4 SGs, rules).

- [ ] **Step 4: Verify with the AWS CLI**

Run: `aws --endpoint-url http://localhost:4566 ec2 describe-subnets --filters Name=tag:Project,Values=plant-parent --query 'Subnets[].[Tags[?Key==\`Name\`]|[0].Value,CidrBlock,AvailabilityZone]' --output table`
Expected: 6 rows, CIDRs exactly as in Global Constraints. And `terraform plan -detailed-exitcode` exits `0` (no drift).

- [ ] **Step 5: Commit**

```bash
git add deployment/01-ec2/network.tf deployment/01-ec2/security.tf
git commit -m "feat(deployment): 3-tier VPC and chained security groups for EC2 stage"
```

---

### Task 4: S3 buckets, artifacts and IAM instance profiles

**Files:**
- Create: `deployment/01-ec2/storage.tf`, `deployment/01-ec2/iam.tf`
- Modify: `deployment/01-ec2/outputs.tf`

**Interfaces:**
- Consumes: `make artifacts` outputs `build/plant-api`, `build/dist.tar.gz`; `var.frontend_dist_dir`.
- Produces: `aws_s3_bucket.media`, `aws_s3_bucket.artifacts`, `aws_s3_object.backend` (key `backend/plant-api`), `aws_s3_object.frontend` (key `frontend/dist.tar.gz`), `local.backend_hash`, `local.frontend_hash`, `aws_iam_instance_profile.app["backend"]`, `aws_iam_instance_profile.app["frontend"]`, `local.db_secret_name` (= `"${var.name}/db"`), output `media_bucket`.

- [ ] **Step 1: `storage.tf`**

```hcl
resource "aws_s3_bucket" "media" {
  bucket        = "${var.name}-media"
  force_destroy = true # local learning stack; never on real data
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.name}-artifacts"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = { media = aws_s3_bucket.media.id, artifacts = aws_s3_bucket.artifacts.id }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  # Content hashes, not tarball hashes: tar embeds mtimes, so rebuilding the
  # same code would otherwise replace the frontend instance on every apply.
  backend_hash  = filemd5("${var.build_dir}/plant-api")
  frontend_hash = md5(join("", [for f in sort(fileset(var.frontend_dist_dir, "**")) : "${f}:${filemd5("${var.frontend_dist_dir}/${f}")}"]))
}

resource "aws_s3_object" "backend" {
  bucket      = aws_s3_bucket.artifacts.id
  key         = "backend/plant-api"
  source      = "${var.build_dir}/plant-api"
  source_hash = local.backend_hash
}

resource "aws_s3_object" "frontend" {
  bucket      = aws_s3_bucket.artifacts.id
  key         = "frontend/dist.tar.gz"
  source      = "${var.build_dir}/dist.tar.gz"
  source_hash = local.frontend_hash
}
```

- [ ] **Step 2: `iam.tf`**

```hcl
locals {
  db_secret_name = "${var.name}/db"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# Backend: its artifact, read/write user media, read the DB secret. Nothing else.
data "aws_iam_policy_document" "backend" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/backend/*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.region}:*:secret:${local.db_secret_name}-*"]
  }
}

# Frontend: only its own artifact.
data "aws_iam_policy_document" "frontend" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/frontend/*"]
  }
}

locals {
  roles = {
    backend  = data.aws_iam_policy_document.backend.json
    frontend = data.aws_iam_policy_document.frontend.json
  }
}

resource "aws_iam_role" "app" {
  for_each           = local.roles
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy" "app" {
  for_each = local.roles
  name     = "${var.name}-${each.key}"
  role     = aws_iam_role.app[each.key].id
  policy   = each.value
}

# An instance profile is the box that hands a role to an EC2 instance (served via IMDS).
resource "aws_iam_instance_profile" "app" {
  for_each = local.roles
  name     = "${var.name}-${each.key}"
  role     = aws_iam_role.app[each.key].name
}
```

- [ ] **Step 3: Add to `outputs.tf`**

```hcl
output "media_bucket" {
  value = aws_s3_bucket.media.id
}
```

- [ ] **Step 4: Build, apply, verify**

Run: `cd deployment/01-ec2 && make apply && aws --endpoint-url http://localhost:4566 s3 ls s3://plant-ec2-artifacts --recursive`
Expected: `backend/plant-api` (~15–25 MB) and `frontend/dist.tar.gz` listed.

- [ ] **Step 5: Verify rebuild is a no-op**

Run: `make artifacts && terraform plan -detailed-exitcode; echo exit=$?`
Expected: `exit=0`. If `exit=2` shows `aws_s3_object.frontend` changing, the frontend hash isn't content-based — fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add deployment/01-ec2/storage.tf deployment/01-ec2/iam.tf deployment/01-ec2/outputs.tf
git commit -m "feat(deployment): S3 buckets, build artifacts and least-privilege instance profiles"
```

---

### Task 5: RDS Postgres and the DB secret

**Files:**
- Create: `deployment/01-ec2/database.tf`

**Interfaces:**
- Consumes: `aws_subnet.db`, `aws_security_group.db`, `local.db_secret_name`, `var.db_host_override`, `var.db_port_override`.
- Produces: `aws_db_instance.main`, `aws_secretsmanager_secret.db` (name `plant-ec2/db`), `aws_secretsmanager_secret_version.db` with JSON keys `username,password,host,port,dbname`.

- [ ] **Step 1: `database.tf`**

```hcl
resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = [for s in aws_subnet.db : s.id]
}

# No special characters: the password goes straight into a postgres:// URL.
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_db_instance" "main" {
  identifier             = var.name
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  db_name                = "plant"
  username               = "plant"
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  skip_final_snapshot    = true
}

# The backend reads this at boot with its instance role; Terraform never puts
# the password into UserData.
resource "aws_secretsmanager_secret" "db" {
  name                    = local.db_secret_name
  recovery_window_in_days = 0 # allow immediate re-create after destroy
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db.result
    host     = var.db_host_override != "" ? var.db_host_override : aws_db_instance.main.address
    port     = var.db_port_override != 0 ? var.db_port_override : aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
  })
}
```

- [ ] **Step 2: Apply and verify the secret**

Run: `cd deployment/01-ec2 && make apply && aws --endpoint-url http://localhost:4566 secretsmanager get-secret-value --secret-id plant-ec2/db --query SecretString --output text | python3 -m json.tool`
Expected: JSON with all five keys; `host`/`port` match `FLOCI-NOTES.md`.

- [ ] **Step 3: Verify the database answers** (from the host, through Floci's RDS proxy port)

Run: `S=$(aws --endpoint-url http://localhost:4566 secretsmanager get-secret-value --secret-id plant-ec2/db --query SecretString --output text); P=$(echo "$S"|python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["password"])'); PORT=$(aws --endpoint-url http://localhost:4566 rds describe-db-instances --db-instance-identifier plant-ec2 --query 'DBInstances[0].Endpoint.Port' --output text); docker run --rm --network host -e PGPASSWORD=$P postgres:16-alpine psql -h localhost -p $PORT -U plant -d plant -c 'select version();'`
Expected: a `PostgreSQL 16.x` row. (If the proxy port isn't published to the host, run the same `docker run` with `--network` set to Floci's compose network and `-h floci` — note which worked in `FLOCI-NOTES.md`.)

- [ ] **Step 4: Commit**

```bash
git add deployment/01-ec2/database.tf
git commit -m "feat(deployment): RDS Postgres in private db subnets with credentials in Secrets Manager"
```

---

### Task 6: EC2 instances with UserData

**Files:**
- Create: `deployment/01-ec2/compute.tf`, `deployment/01-ec2/templates/{bootstrap.sh,backend.sh.tftpl,frontend.sh.tftpl}`
- Modify: `deployment/01-ec2/outputs.tf`

**Interfaces:**
- Consumes: `aws_subnet.app["a"]`, `aws_security_group.{frontend,backend}`, `aws_iam_instance_profile.app["backend"|"frontend"]`, `aws_s3_object.{backend,frontend}`, `local.{backend_hash,frontend_hash,db_secret_name}`, `aws_secretsmanager_secret_version.db`, `aws_s3_bucket.{media,artifacts}`, `var.{ami_id,instance_type,use_systemd,instance_aws_endpoint}`.
- Produces: `aws_instance.backend`, `aws_instance.frontend`; outputs `backend_instance_id`, `frontend_instance_id`; private key at `build/ssh/id_rsa`. Bootstrap shell helpers `awsx` (aws CLI with optional endpoint) and `$ENDPOINT`, `$IMDS`.

- [ ] **Step 1: `templates/bootstrap.sh`** (plain file, prepended to both UserData scripts; no Terraform interpolation)

```bash
#!/bin/bash
# Shared UserData prelude: logging, base packages, AWS CLI v2.
set -euxo pipefail
exec > >(tee -a /var/log/user-data.log) 2>&1

# Wait for systemd if this image runs it (cloud image); harmless otherwise.
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  systemctl is-system-running --wait || true
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl unzip jq

if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscliv2.zip
fi
```

- [ ] **Step 2: `templates/backend.sh.tftpl`** (Terraform template: `${...}` is Terraform, `$${...}` is bash)

```bash
# ---- backend (artifact ${artifact_hash}) ----
# Floci injects AWS_ENDPOINT_URL / AWS_EC2_METADATA_SERVICE_ENDPOINT into instances.
# On real AWS both are unset and the CLI/SDK use the normal endpoints and IMDS.
ENDPOINT="$${AWS_ENDPOINT_URL:-${instance_aws_endpoint}}"
IMDS="$${AWS_EC2_METADATA_SERVICE_ENDPOINT:-}"
awsx() { aws --region ${region} $${ENDPOINT:+--endpoint-url "$ENDPOINT"} "$@"; }

id plant >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin plant
install -d -m 0755 /opt/plant
awsx s3 cp "s3://${artifacts_bucket}/backend/plant-api" /opt/plant/plant-api
chmod 0755 /opt/plant/plant-api

SECRET=$(awsx secretsmanager get-secret-value --secret-id "${db_secret_name}" --query SecretString --output text)
DB_URL=$(echo "$SECRET" | jq -r '"postgres://\(.username):\(.password)@\(.host):\(.port)/\(.dbname)?sslmode=disable"')

install -d -m 0700 /etc/plant  # systemd reads EnvironmentFile as root
cat > /etc/plant/env <<EOF
PORT=8080
DATABASE_URL=$DB_URL
S3_BUCKET=${media_bucket}
AWS_REGION=${region}
AWS_ENDPOINT_URL=$ENDPOINT
AWS_EC2_METADATA_SERVICE_ENDPOINT=$IMDS
EOF
chmod 0600 /etc/plant/env

%{ if use_systemd ~}
cat > /etc/systemd/system/plant-api.service <<'EOF'
[Unit]
Description=Plant Parent API
After=network-online.target
Wants=network-online.target

[Service]
User=plant
EnvironmentFile=/etc/plant/env
ExecStart=/opt/plant/plant-api
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now plant-api
%{ else ~}
# Fallback image without systemd: run directly, restart loop instead of Restart=always.
nohup bash -c 'set -a; . /etc/plant/env; while true; do su -s /bin/sh plant -c /opt/plant/plant-api; sleep 2; done' \
  >>/var/log/plant-api.log 2>&1 &
%{ endif ~}
```

- [ ] **Step 3: `templates/frontend.sh.tftpl`**

```bash
# ---- frontend (artifact ${artifact_hash}) ----
ENDPOINT="$${AWS_ENDPOINT_URL:-${instance_aws_endpoint}}"
awsx() { aws --region ${region} $${ENDPOINT:+--endpoint-url "$ENDPOINT"} "$@"; }

apt-get install -y -q --no-install-recommends nginx
awsx s3 cp "s3://${artifacts_bucket}/frontend/dist.tar.gz" /tmp/dist.tar.gz
rm -rf /var/www/plant && install -d /var/www/plant
tar -xzf /tmp/dist.tar.gz -C /var/www/plant && rm /tmp/dist.tar.gz

# Static files only — the ALB sends /api/* to the backend, never to nginx.
cat > /etc/nginx/sites-available/default <<'EOF'
server {
    listen 80 default_server;
    root /var/www/plant;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # React Router: unknown paths are client-side routes.
    location / {
        try_files $uri /index.html;
    }
}
EOF
nginx -t
%{ if use_systemd ~}
systemctl enable nginx && systemctl restart nginx
%{ else ~}
nginx
%{ endif ~}
```

- [ ] **Step 4: `compute.tf`**

```hcl
# Terraform generates the SSH key; the private half is only written locally.
resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "local_sensitive_file" "ssh_key" {
  content         = tls_private_key.ssh.private_key_openssh
  filename        = "${var.build_dir}/ssh/id_rsa"
  file_permission = "0600"
}

resource "aws_key_pair" "main" {
  key_name   = var.name
  public_key = tls_private_key.ssh.public_key_openssh
}

locals {
  template_vars = {
    region                = var.region
    instance_aws_endpoint = var.instance_aws_endpoint
    artifacts_bucket      = aws_s3_bucket.artifacts.id
    use_systemd           = var.use_systemd
  }
  bootstrap = file("${path.module}/templates/bootstrap.sh")
}

resource "aws_instance" "backend" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app["a"].id
  vpc_security_group_ids      = [aws_security_group.backend.id]
  iam_instance_profile        = aws_iam_instance_profile.app["backend"].name
  key_name                    = aws_key_pair.main.key_name
  user_data_replace_on_change = true # new artifact hash → new instance

  user_data = join("\n", [local.bootstrap, templatefile("${path.module}/templates/backend.sh.tftpl", merge(local.template_vars, {
    artifact_hash  = local.backend_hash
    media_bucket   = aws_s3_bucket.media.id
    db_secret_name = local.db_secret_name
  }))])

  # The instance reads these at boot, so they must exist first.
  depends_on = [aws_s3_object.backend, aws_secretsmanager_secret_version.db, aws_iam_role_policy.app]
  tags       = { Name = "${var.name}-backend" }
}

resource "aws_instance" "frontend" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app["a"].id
  vpc_security_group_ids      = [aws_security_group.frontend.id]
  iam_instance_profile        = aws_iam_instance_profile.app["frontend"].name
  key_name                    = aws_key_pair.main.key_name
  user_data_replace_on_change = true

  user_data = join("\n", [local.bootstrap, templatefile("${path.module}/templates/frontend.sh.tftpl", merge(local.template_vars, {
    artifact_hash = local.frontend_hash
  }))])

  depends_on = [aws_s3_object.frontend, aws_iam_role_policy.app]
  tags       = { Name = "${var.name}-frontend" }
}
```

- [ ] **Step 5: Add to `outputs.tf`**

```hcl
output "backend_instance_id" {
  value = aws_instance.backend.id
}

output "frontend_instance_id" {
  value = aws_instance.frontend.id
}
```

- [ ] **Step 6: Apply, then verify both instances from the inside**

Run: `cd deployment/01-ec2 && terraform fmt -check && terraform validate && make apply`, wait ~60–90 s for UserData (apt + AWS CLI), then:
- `./scripts/ssh.sh $(terraform output -raw backend_instance_id) 'tail -5 /var/log/user-data.log; systemctl is-active plant-api; curl -s localhost:8080/api/health'`
  Expected: `active` and `{"status":"ok"}` (health pings RDS, so this proves secret → DB URL → RDS works).
- `./scripts/ssh.sh $(terraform output -raw frontend_instance_id) 'systemctl is-active nginx; curl -s localhost/ | head -c 200; curl -s -o /dev/null -w "%{http_code}\n" localhost/plants/x'`
  Expected: `active`, HTML containing `<div id="root">`, `200`.

If health is not ok: `./scripts/ssh.sh <id> journalctl -u plant-api -n 50` and `/var/log/user-data.log`; fix the template, `make apply` (the changed UserData replaces the instance).

- [ ] **Step 7: Review Focus #4 — systemd restarts a dead API**

Run: `./scripts/ssh.sh $(terraform output -raw backend_instance_id) 'pkill -f /opt/plant/plant-api; sleep 4; systemctl is-active plant-api; curl -s localhost:8080/api/health'`
Expected: `active` and `{"status":"ok"}`. (Fallback image: the restart loop gives the same result.)

- [ ] **Step 8: Commit**

```bash
git add deployment/01-ec2/compute.tf deployment/01-ec2/templates deployment/01-ec2/outputs.tf
git commit -m "feat(deployment): backend and frontend EC2 instances bootstrapped from S3 artifacts"
```

---

### Task 7: Application Load Balancer — the acceptance test goes green

**Files:**
- Create: `deployment/01-ec2/alb.tf`
- Modify: `deployment/01-ec2/outputs.tf`

**Interfaces:**
- Consumes: `aws_subnet.public`, `aws_security_group.alb`, `aws_vpc.main`, `aws_instance.{backend,frontend}`, `var.alb_listener_port`.
- Produces: `aws_lb.main`, `aws_lb_target_group.{backend,frontend}`; outputs `alb_dns_name`, `backend_target_group_arn`, `frontend_target_group_arn` (used by `make health`).

- [ ] **Step 1: `alb.tf`**

```hcl
resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]
}

resource "aws_lb_target_group" "frontend" {
  name        = "${var.name}-frontend"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/"
    matcher             = "200"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.name}-backend"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/api/health" # 503 when the DB is unreachable → target goes unhealthy
    matcher             = "200"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group_attachment" "frontend" {
  target_group_arn = aws_lb_target_group.frontend.arn
  target_id        = aws_instance.frontend.id
  port             = 80
}

resource "aws_lb_target_group_attachment" "backend" {
  target_group_arn = aws_lb_target_group.backend.arn
  target_id        = aws_instance.backend.id
  port             = 8080
}

# Default: everything goes to the frontend…
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# …except the API.
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}
```

- [ ] **Step 2: Add to `outputs.tf`**

```hcl
output "alb_dns_name" {
  description = "What you would CNAME on real AWS. Locally, use app_url."
  value       = aws_lb.main.dns_name
}

output "backend_target_group_arn" {
  value = aws_lb_target_group.backend.arn
}

output "frontend_target_group_arn" {
  value = aws_lb_target_group.frontend.arn
}
```

- [ ] **Step 3: Apply and wait for healthy targets**

Run: `cd deployment/01-ec2 && terraform fmt -check && terraform validate && make apply && sleep 30 && make health`
Expected: both target groups show the instance `healthy`.

- [ ] **Step 4: Run the acceptance test**

Run: `make smoke`
Expected: every line `ok`, ending `SMOKE PASSED`.

- [ ] **Step 5: Manual browser check** — open `terraform output -raw app_url` (http://localhost:8088): garden page loads, add a plant, upload a photo, open the plant page, reload it (deep link served by nginx fallback).

- [ ] **Step 6: Commit**

```bash
git add deployment/01-ec2/alb.tf deployment/01-ec2/outputs.tf
git commit -m "feat(deployment): ALB with /api/* path routing; EC2 stage passes smoke test"
```

---

### Task 8: Docs, idempotency, SG experiment, clean teardown

**Files:**
- Create: `deployment/01-ec2/README.md`
- Modify: `README.md` (root)

- [ ] **Step 1: SG experiment (records a real result for the README)** — with the stack up, delete the backend's ALB ingress rule and watch traffic break, then restore it:

```bash
cd deployment/01-ec2
RULE=$(terraform state list | grep -E 'from_alb(_cidr)?\["backend"\]')
terraform destroy -target="$RULE" -auto-approve
sleep 35; make health                       # expected: backend unhealthy (if Floci enforces this path)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/api/health   # expected: 502/503/504
make apply && sleep 30 && make health       # restored: healthy again
```

Record the observed result (broke / did not break) in the README; if it didn't break, say Floci does not enforce the ALB → instance path and note which path it does enforce per `FLOCI-NOTES.md`.

- [ ] **Step 2: Review Focus #1 — idempotent apply**

Run: `make artifacts && terraform plan -detailed-exitcode; echo exit=$?`
Expected: `exit=0`.

- [ ] **Step 3: Write `deployment/01-ec2/README.md`** with these sections (fill in the real outputs observed in Tasks 1–8):

```markdown
# Stage 1 — Classic EC2 deployment (on Floci)

<architecture diagram from the spec>

## Run it
    make up                      # repo root: Postgres + Floci (docker socket mounted)
    cd deployment/01-ec2
    make init
    make apply                   # builds artifacts, then terraform apply (~2 min: instances run apt + AWS CLI install)
    make health                  # both target groups healthy?
    make smoke                   # end-to-end test through the ALB
    open http://localhost:8088
    make destroy

## What each file teaches
| File | AWS concept |
|---|---|
| network.tf | VPC, public vs private subnets, IGW, NAT, route tables |
| security.tf | security groups chained by reference (alb → app → db) |
| storage.tf | S3 buckets, build artifacts, content hashes |
| iam.tf | roles, least-privilege policies, instance profiles |
| database.tf | RDS in private subnets, DB subnet groups, Secrets Manager |
| compute.tf + templates/ | EC2, AMIs, key pairs, UserData bootstrapping, systemd |
| alb.tf | ALB, listeners, target groups, health checks, path routing |

## Redeploying
Change code → `make apply`. Only the instance whose artifact changed is replaced (`user_data_replace_on_change`).

## Debugging
`make ssh-backend` → `journalctl -u plant-api -f`, `cat /var/log/user-data.log`, `cat /etc/plant/env`.

## Floci vs real AWS
- IGW / NAT / route tables: metadata only on Floci (Docker provides outbound access).
- Security groups: <enforced? which paths? — from Task 1 and the Step 1 experiment>.
- App URL: the ALB DNS name doesn't resolve locally; docker-compose publishes the listener on localhost:8088.
- To run on real AWS: drop the endpoints/static keys/skip_* in providers.tf, use a real AMI id, remove AWS_ENDPOINT_URL handling, add HTTPS.

## Floci restarted?
Floci keeps state in memory. After `docker compose down/up` the resources are gone but terraform.tfstate still lists them:
`make forget && make apply`.

## Experiment: break a security group
<Step 1 commands and the observed result>
```

- [ ] **Step 4: Root `README.md`** — replace the line `- \`infra/\` — Terraform: ECR → ECS (2 services) → ALB → RDS → S3 on Floci` with:

```markdown
- `deployment/` — Terraform deployments on Floci, one folder per style: [01-ec2](deployment/01-ec2/) (VPC + ALB + EC2 + RDS + S3), then ECS and EKS
```

- [ ] **Step 5: Clean teardown + Review Focus #5**

Run: `make destroy && docker ps --format '{{.Names}} {{.Image}}' | grep -v -E 'fullstack-devops-(postgres|floci)-1' || echo "nothing left"`
Expected: `nothing left` (no instance, RDS or socat containers). Then `make apply && make smoke` once more from scratch → `SMOKE PASSED`, and `make destroy`.

Then the Floci-restart path: `make apply`, `cd ../.. && docker compose restart floci && cd deployment/01-ec2`, `make forget && make apply && make smoke` → `SMOKE PASSED`; `make destroy`. (If orphaned instance containers from before the restart linger, add their removal to the README's "Floci restarted?" section with the exact `docker rm -f` filter.)

- [ ] **Step 6: Root tests still pass**

Run: `cd ../.. && make test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add deployment/01-ec2/README.md README.md
git commit -m "docs(deployment): EC2 stage guide, Floci caveats and security-group experiment"
```
