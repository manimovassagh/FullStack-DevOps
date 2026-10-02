# EKS (Kubernetes) deployment — on Floci

```
Browser ─► ALB localhost:8090
             ├─ /api/* ─► target group backend  ─► node:30081 ─► Service backend  (NodePort) ─► 2 backend pods
             └─ /*     ─► target group frontend ─► node:30080 ─► Service frontend (NodePort) ─► 2 frontend pods
 backend pods ─► RDS Postgres (DATABASE_URL: Secrets Manager → Kubernetes Secret)   ─► S3 plant-eks-media
 control plane: EKS (k3s on Floci)   images: ECR plant-eks-backend, plant-eks-frontend
```

Two tools, two layers, like most real EKS teams:

- **Terraform** builds the platform: VPC, cluster, node group, ECR, RDS, S3, ALB, IAM.
- **kubectl + Kustomize** ship the app into the cluster: [k8s/](k8s/) holds plain manifests, and `make app` renders an overlay with the image tag and Terraform outputs.

## Run it

    make up                  # repo root: Postgres + Floci
    cd deployment/eks
    make init
    make up                  # images → ECR → terraform apply → kubeconfig → secrets → app → ALB targets → healthy
    make smoke               # API + browser smoke tests through the ALB
    open http://localhost:8090
    make destroy

`make up` is just these steps in order; run them one at a time to see each layer:

| Step | What happens |
|---|---|
| `make images push` | build both images, push them to ECR |
| `make deploy` | `terraform apply`: the platform, no app yet |
| `make kubeconfig` | `aws eks update-kubeconfig` → `build/kubeconfig`; `kubectl get nodes` |
| `make secrets` | `DATABASE_URL` from Secrets Manager → Kubernetes Secret `database` |
| `make app` | `kubectl apply -k` + `kubectl rollout status` |
| `make register` | register the nodes' NodePorts in the ALB target groups |
| `make wait` | block until every target is healthy |

Then use kubectl yourself: `export KUBECONFIG=$PWD/build/kubeconfig; kubectl -n plant get pods,svc,rs`.

`make check` proves the platform is idempotent (`terraform plan` shows no changes).

## Redeploying

Commit a change and run `make images push app`. The new commit is the image tag. Kubernetes creates a new ReplicaSet and swaps pods one at a time (`maxUnavailable: 0`: a new pod must pass its readiness probe before an old one goes). `make rollout` tests exactly that. Roll back with `kubectl -n plant rollout undo deploy/backend`.

## What each file teaches

| File | Concept |
|---|---|
| eks.tf | control plane (version, endpoint access, KMS secrets encryption), managed node group, IAM user + access entry for kubectl |
| iam.tf | cluster role vs node role vs IRSA role (pod → IAM via the cluster's OIDC provider) |
| alb.tf | ALB → NodePort ("instance mode"), path routing |
| k8s/backend.yaml | ServiceAccount with IRSA annotation, Deployment, probes, resources, non-root security context, Secret/ConfigMap env |
| k8s/frontend.yaml | read-only root filesystem with `emptyDir` for the paths nginx writes |
| k8s/services.yaml | NodePort Services |
| scripts/register-nodes.sh | what the AWS Load Balancer Controller does for you |
| database.tf | RDS + a connection-string secret, synced into the cluster by `make secrets` |

## Compared with ECS

| | ecs | eks |
|---|---|---|
| scheduler | ECS service | Kubernetes Deployment / ReplicaSet |
| app definition | task definition (Terraform) | manifests (`k8s/`, kubectl) |
| ALB targets | task IPs, registered by the service | node NodePorts, registered by a controller (here: a script) |
| code's AWS permissions | task role | IRSA: ServiceAccount → IAM role via OIDC |
| secrets | ECS injects from Secrets Manager | Kubernetes Secret (on AWS: often External Secrets / CSI driver) |
| redeploy | new revision | new ReplicaSet, readiness-gated rolling update |
| who can deploy | IAM | IAM to reach the API (access entries) + Kubernetes RBAC inside |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).
