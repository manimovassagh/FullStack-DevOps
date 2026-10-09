# Classic EC2 deployment — on Floci

```
Browser ─► ALB localhost:8088
             ├─ /api/* ─► target group backend  ◄─ EC2 instance backend  (systemd: Go API on :8080)
             └─ /*     ─► target group frontend ◄─ EC2 instance frontend (nginx + React build)
 backend ─► RDS Postgres (password from Secrets Manager, read at boot) ─► S3 media bucket
 artifacts: plant-api binary + dist.tar.gz in S3 plant-ec2-artifacts, downloaded by UserData
```

The oldest way to run the app on AWS: two hand-made virtual machines. Each one boots, runs its UserData script, downloads its build from S3 and starts it as a systemd service.

## Run it

    make up                  # repo root: Postgres + Floci
    cd deployment/aws/classic-ec2
    make init
    make apply               # build the Go binary + React bundle → bake the AMI image → terraform apply
    make wait                # both target groups healthy (UserData takes a minute or two)
    make smoke               # API + browser smoke tests through the ALB
    open http://localhost:8088
    make destroy

`make check` proves the deployment is idempotent (`terraform plan` shows no changes). `make ssh-backend` and `make ssh-frontend` open a shell on an instance, and `make health` prints the target health.

## Redeploying

Commit a change and run `make apply`: new artifacts get a new hash, the hash is part of the UserData, and a changed UserData replaces the instance. Unlike the later stages, the old instance is gone before the new one is healthy, so a redeploy has downtime. [ec2-asg](../ec2-asg/) fixes this.

## What each file teaches

| File | AWS concept |
|---|---|
| network.tf | VPC with three tiers (public, app, data), internet gateway, NAT gateway, route tables |
| security.tf | security-group chain: internet → alb → frontend/backend → db, rules that reference other groups |
| compute.tf | EC2 instances, key pairs (Terraform generates the SSH key), UserData, IMDSv2 |
| templates/ | UserData scripts: a shared prelude (`bootstrap.sh`) plus one template per tier |
| iam.tf | one role per tier, handed to the instance through an instance profile |
| storage.tf | S3 buckets for media and build artifacts, public access block |
| database.tf | RDS Postgres, a generated password kept in Secrets Manager (never in UserData) |
| alb.tf | instance target groups, path routing (`/api/*` to the backend) |
| floci.tf | Floci-only plumbing (the ALB joins the VPC network); delete it for real AWS |
| ami/ | the "baked AMI": Ubuntu 24.04 + systemd + sshd, built locally for Floci |

## Compared with ec2-asg

| | classic-ec2 | ec2-asg |
|---|---|---|
| instances | one `aws_instance` per tier, made by hand | Launch Template + Auto Scaling Group per tier |
| an instance dies | it stays dead | the group launches a replacement |
| redeploy | replace the instance (downtime) | new launch-template version, rolling replacement |
| ALB targets | attached by Terraform | registered by the group |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md). Shared tests: [smoke](../../smoke/).
