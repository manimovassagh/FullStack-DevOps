# Floci notes for the eks-helm stage

Everything in [the eks stage's notes](../eks/FLOCI-NOTES.md) applies unchanged (one k3s node, the kubectl IAM user, node registration for the ALB, IRSA declared but not used, no load-balancer controller). Helm adds nothing Floci-specific: it talks to the k3s API server through the same kubeconfig, and a release is a Secret in the `plant` namespace.

## Notes

- **Helm release state lives in the cluster.** `helm history` reads Secrets of type `helm.sh/release.v1`; destroying the cluster destroys the history.
- **Secrets are outside the chart.** `make secrets` creates `database` and `aws-local` before the first `helm install`; the chart only references them (the backend Deployment fails to start without `database`).
- **Ports.** The ALB listener is 85, published as host port 8094 by `docker-compose.yml` (changing ports restarts Floci and wipes every stack).
- **`make rollout` needs the local images** of the current commit (`plant/<svc>:$IMAGE_TAG`); after a rebase the commit changes, so pass `IMAGE_TAG=<the tag the cluster runs>`.
