# Deployments

A blueprint for deploying the Plant Parent full-stack app (React + Go + Postgres + S3) in different ways, for learning.
Every folder is one deployment style and holds everything that style needs: Terraform, scripts, Makefile and README. Each folder is applied and destroyed on its own.

The AWS stages run **locally on [Floci](https://floci.io)**, so no cloud account is needed.

| Folder | Style | What you learn |
|---|---|---|
| [classic-ec2](aws/classic-ec2/) | VPC + ALB + EC2 + RDS + S3 | public/private subnets, security groups, EC2 UserData + systemd, IAM instance profiles, Secrets Manager |
| [ecs](aws/ecs/) | ECS Fargate + ALB + RDS + S3 | Docker images in ECR, task definitions, services, execution vs task roles, secrets injection |
| [ecs-cloudfront](aws/ecs-cloudfront/) | CloudFront + S3 (React) + ALB + ECS Fargate (API) + RDS | the most common SPA + container API layout: two origins, cache behaviours, origin access control, an ALB that only answers CloudFront (secret header, prefix list), frontend releases as `s3 sync` + invalidation |
| [eks](aws/eks/) | EKS (Kubernetes) + ALB + RDS + S3 | cluster vs app layer (Terraform + kubectl/Kustomize), node groups, NodePort + ALB, IRSA, kubectl auth with `aws eks get-token` |
| [eks-helm](aws/eks-helm/) | EKS + the app as a Helm chart | charts, values, releases and revisions, `helm upgrade --install`, `helm rollback`, templating vs patching |
| [ec2-asg](aws/ec2-asg/) | EC2 behind Auto Scaling Groups | launch templates and versions, Auto Scaling Groups, ALB registration by the group, self-healing, rolling replacement (instance refresh), target-tracking policies |
| [eks-gitops](aws/eks-gitops/) | EKS + Argo CD pulling from git | GitOps: the repo is the source of truth, a release is a commit, rollback is `git revert`, self-healing drift, no cluster credentials in CI |
| [ecs-cognito](aws/ecs-cognito/) | ECS Fargate + ALB + RDS + S3 + Amazon Cognito | user pools and app clients, JWT verification with the pool's JWKS, per-user data, an admin group, a backend-for-frontend sign-in with an HttpOnly refresh cookie; own app copies `backend-auth/`, `frontend-auth/` |
| [ecs-alb-auth](aws/ecs-alb-auth/) | ECS Fargate + ALB authenticate-cognito + RDS + S3 | sign-in at the load balancer: hosted UI, confidential app client, ALB session cookie, 302 for pages vs 401 for the API; the unchanged backend/ and frontend/ |
| [serverless-gateway-auth](aws/serverless-gateway-auth/) | Lambda + API Gateway JWT authorizer + CloudFront + S3 + Amazon Cognito | the token is checked by API Gateway before the function runs: JWT authorizers, open vs protected routes, a 401 that never invokes the Lambda; same app as serverless-cognito |
| [ecs-blue-green](aws/ecs-blue-green/) | ECS Fargate + weighted ALB (two environments) | blue/green and canary releases, weighted target groups, a preview listener, instant rollback, a release state machine |
| [serverless-cognito](aws/serverless-cognito/) | Lambda + API Gateway + CloudFront + S3 + Amazon Cognito | the serverless recipe with sign-in: JWT checks in the function, per-user data, cookies through API Gateway payload 2.0; own copies `backend-serverless-auth/`, `frontend-auth/` |
| [serverless](aws/serverless/) | Lambda + API Gateway + CloudFront + S3 | function packaging and cold starts, API Gateway events, versions and aliases, CloudFront origins and behaviors, a private S3 site with origin access control, secrets read by the function |

Google Cloud and Azure (one stage each, the most common container setup of each) have their own sections below. Next stages, the target folder structure and the rules for adding a stage: [ROADMAP.md](ROADMAP.md).

## Prerequisites

Docker, Terraform ≥ 1.14, AWS CLI v2, Go 1.26+, Node 22+, kubectl (eks). From the repo root, `make up` starts Postgres and Floci (Floci gets the Docker socket so it can run instances as containers).

## Google Cloud

Runs on the [Floci GCP emulator](https://github.com/floci-io/floci-gcp) (its own compose file in the stage). The API is a copy of the backend with Cloud Storage as photo storage ([`backend-gcp/`](../backend-gcp/)).

| Folder | Style | What you learn |
|---|---|---|
| [gcp/cloud-run](gcp/cloud-run/) | Cloud Run + Cloud SQL + Cloud Storage | revisions, service accounts, Secret Manager, a gateway in front of three services, the client library against an emulator |

## Azure

Runs on the [Floci Azure emulator](https://github.com/floci-io/floci-az) (its own compose file in the stage). The repo's backend and frontend are deployed unchanged; photos go to an S3-compatible store because Azure Blob has no S3 interface.

| Folder | Style | What you learn |
|---|---|---|
| [azure/container-apps](azure/container-apps/) | Container Apps + PostgreSQL Flexible Server | environments, apps and revisions, app secrets, ingress, the azurerm provider against a custom cloud |
