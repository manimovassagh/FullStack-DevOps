# eks-gitops: Argo CD pulls the release from git

The same Kubernetes platform as [`../eks`](../eks) and [`../eks-helm`](../eks-helm) (Terraform: VPC, EKS, ECR, RDS, S3, ALB), but nothing pushes the app into the cluster. **Argo CD runs inside the cluster, watches a git repo, and keeps the cluster equal to it.** A release is a commit.

```
 you / CI ──git push──▶ git repo (chart/ + env/values.yaml)
                              ▲
                              │ pulls every 20 s (or on refresh)
                        Argo CD ── helm template ──▶ Kubernetes API ──▶ Deployments, Services
 Browser ─► ALB localhost:8095 ─► NodePorts ─► pods
```

The "git remote" here is a bare repo inside a `git daemon` container on the compose network (read-only for the network; you push through `docker exec`), so the whole loop works offline with no GitHub token. On a real setup it is a GitHub/GitLab repo.

## Run it

    make up                  # repo root first: Postgres + Floci
    cd deployment/aws/eks-gitops
    make init
    make up                  # images → ECR → terraform → kubeconfig → secrets → git remote → Argo CD → Application → ALB targets
    make smoke               # API + browser tests through http://localhost:8095
    make destroy

The GitOps loop:

    make release TAG=v2      # pushes the images, commits the new tag into env/values.yaml; Argo CD deploys it
    make status              # Synced / Healthy at which git revision, and the repo's log
    make revert              # roll back: git revert of the last commit; Argo CD deploys the old state
    make rollout             # the whole journey as a test (below)

`make rollout` asserts: **release** (a commit changes the image tag → the cluster runs the new image), **rollback** (`git revert` → the old image is back), **drift** (`kubectl scale` the backend by hand → Argo CD's self-heal puts the replica count back to what git says).

## How it differs from eks and eks-helm

| | eks (Kustomize) | eks-helm | eks-gitops |
|---|---|---|---|
| who applies | you, `kubectl apply -k` | you, `helm upgrade` | Argo CD, in the cluster |
| source of truth | your working tree at that moment | the chart + `--set` flags you passed | the git repo |
| a release is | a command | a command (a Helm revision) | a commit |
| rollback | re-apply an old commit | `helm rollback` | `git revert` |
| manual changes in the cluster | stay until the next apply | stay | reverted by self-heal |
| cluster credentials needed by CI | yes | yes | no (CI only pushes to git) |
| audit trail | CI logs | `helm history` | `git log` |

## What is in the repo Argo CD watches

`chart/` is the Helm chart (a copy of `helm/plant`, the same one as in eks-helm) and `env/values.yaml` holds what differs per environment (image tags, bucket, role ARN, registry); `make gitrepo` writes the first commit from Terraform outputs. The Argo CD `Application` (`build/application.yaml`) points at `chart/` with `../env/values.yaml`, with `automated: { prune, selfHeal }`. The database and Floci Secrets are created by `make secrets`, outside git, on purpose: never commit credentials to the repo Argo CD reads.

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).
