# eks-helm: the app as a Helm chart on EKS

The same Kubernetes platform as [`../eks`](../eks) (Terraform: VPC, EKS, ECR, RDS, S3, ALB), but the app is delivered as a **Helm chart**, so each deploy is a numbered *release* you can inspect and roll back.

```
Browser ─► ALB localhost:8094 ─► NodePorts ─► pods   (nodes registered by scripts/register-nodes.sh, as in eks)

terraform apply  →  the platform (cluster, ALB, database, buckets, IAM)
make secrets     →  Kubernetes Secrets (database URL, Floci keys), created outside the chart
helm upgrade --install plant helm/plant  →  ServiceAccount, ConfigMap, Deployments, Services
```

## Run it

    make up                  # repo root first: Postgres + Floci
    cd deployment/aws/eks-helm
    make init
    make up                  # images → ECR → terraform → kubeconfig → secrets → helm install → ALB targets → wait
    make smoke               # API + browser tests through http://localhost:8094
    make destroy

Day-to-day with Helm:

    make lint                # helm lint + render the chart
    make app                 # helm upgrade --install: a new revision (images from the current commit)
    make history             # revision 1 deployed → superseded → …
    make rollback REV=1      # back to revision 1 (creates a new revision; the image of revision 1 returns)
    make rollout             # test: upgrade, rollback, upgrade, with an API smoke test after each

## How it differs from `eks` (Kustomize)

| | eks (Kustomize) | eks-helm |
|---|---|---|
| unit | plain manifests + a generated overlay | a chart (`helm/plant`): templates + `values.yaml` |
| change images / config | the overlay is rewritten | `--set image.backend.tag=…` or a values file |
| apply | `kubectl apply -k` | `helm upgrade --install --wait` |
| history | none (git is the history) | numbered revisions in the cluster (`helm history`) |
| rollback | re-apply an older commit | `helm rollback plant <rev>` |
| config change rolls pods | no | yes: the ConfigMap checksum is a pod annotation |
| templating logic | patches only | Go templates (`required`, `include`, `toYaml`) |

## The chart

`helm/plant/values.yaml` holds the knobs (image registry and tags, replicas, resources, NodePorts, the IRSA role ARN, the S3 bucket); `make app` fills in the ones that come from Terraform outputs. `templates/_helpers.tpl` builds image references, `backend.yaml` and `frontend.yaml` are the Deployments (the same hardening as `eks`: non-root, read-only filesystem, dropped capabilities), and the database and Floci Secrets are deliberately **not** in the chart: credentials should not live in a release's stored history.

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).
