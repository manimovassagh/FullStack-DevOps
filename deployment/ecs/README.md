# ECS (Fargate) deployment — on Floci

```
Browser ─► ALB localhost:8089
             ├─ /api/* ─► target group backend  (ip) ◄─ ECS service backend  (Fargate task: Go API, distroless image)
             └─ /*     ─► target group frontend (ip) ◄─ ECS service frontend (Fargate task: nginx + React build)
 backend task ─► RDS Postgres (DATABASE_URL from Secrets Manager)   ─► S3 plant-ecs-media
 images: ECR plant-ecs-backend, plant-ecs-frontend
```

## Run it

    make up                  # repo root: Postgres + Floci
    cd deployment/ecs
    make init
    make apply               # build images → push to ECR → terraform apply
    make wait                # both target groups healthy
    make smoke               # API + browser smoke tests through the ALB
    open http://localhost:8089
    make destroy

`make check` proves the deployment is idempotent (`terraform plan` shows no changes).

## Redeploying

Commit a change and run `make apply`: the images get the new commit as their tag, Terraform registers new task-definition revisions, and each service replaces its task (new task healthy → old one drained). Pin a tag with `make apply IMAGE_TAG=v1`.

## What each file teaches

| File | AWS concept |
|---|---|
| ecr.tf | container registries, lifecycle policies |
| ecs.tf | cluster, Fargate task definitions (CPU/memory, awsvpc, secrets, logs), services with load balancers |
| iam.tf | execution role (start the task) vs task role (your code's permissions) |
| alb.tf | IP target groups, path routing |
| database.tf | RDS + a connection-string secret injected with `secrets.valueFrom` |
| network.tf / security.tf | VPC tiers; security groups per task ENI |

## Compared with classic-ec2

| | classic-ec2 | ecs |
|---|---|---|
| unit of deployment | AMI + UserData + systemd | container image + task definition |
| shipping code | artifacts in S3, pulled at boot | `docker push` to ECR |
| permissions | one instance profile | execution role + task role |
| secrets | UserData reads Secrets Manager | ECS injects `DATABASE_URL` |
| ALB targets | instances | task IPs, registered by the service |
| redeploy | replace the instance | new revision, rolling replacement |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).
