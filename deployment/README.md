# Deployments

A blueprint for deploying the Plant Parent full-stack app (React + Go + Postgres + S3) in different ways, for learning.
Every folder is one deployment style and holds everything that style needs: Terraform, scripts, Makefile and README. Each folder is applied and destroyed on its own.

The AWS stages run **locally on [Floci](https://floci.io)**, so no cloud account is needed.

| Folder | Style | What you learn |
|---|---|---|
| [classic-ec2](classic-ec2/) | VPC + ALB + EC2 + RDS + S3 | public/private subnets, security groups, EC2 UserData + systemd, IAM instance profiles, Secrets Manager |
| ecs (planned) | Elastic Container Service | images in ECR, task definitions, services |
| eks (planned) | Elastic Kubernetes Service | Kubernetes on AWS |

Later: Azure and Google Cloud equivalents in their own folders.

## Prerequisites

Docker, Terraform ≥ 1.14, AWS CLI v2, Go 1.26+, Node 22+. From the repo root, `make up` starts Postgres and Floci (Floci gets the Docker socket so it can run instances as containers).
