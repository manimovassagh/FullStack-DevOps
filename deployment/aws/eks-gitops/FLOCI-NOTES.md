# Floci notes for the eks-gitops stage

Everything in [the eks stage's notes](../eks/FLOCI-NOTES.md) applies unchanged. Argo CD runs as ordinary pods in the k3s cluster, so Floci needs nothing special; what is different is the network around it.

## Notes

- **Argo CD images come from the internet.** The k3s node pulls `quay.io/argoproj/argocd` and a Redis image from `public.ecr.aws` (Floci's ECR mirror only covers its own ECR). The install manifest is the pinned upstream `core-install.yaml` (`ARGO_VERSION` in the Makefile): no UI, no SSO, so only four small pods.
- **The git remote is a container.** Argo CD's git client speaks the smart git protocol, so a static file server is not enough (`failed to list refs: unexpected EOF`). `make gitserver` runs Alpine's `git daemon` on the compose network with the bare repo `plant.git` inside the container, read-only; Argo CD reads `git://<container ip>/plant.git` (the node reaches the container's IP on the compose network, like it reaches Floci). `make` writes through `docker exec` (git's `ext::` transport), so no container on the network can push and no port is published. The repo is not bind-mounted from `build/`: in a CI job that runs in a container (the local Gitea runner), a bind-mount path names a folder on the Docker host that does not exist there, and the daemon served an empty directory (`repository not found`).
- **The `default` project is created by `make argocd`.** The core install ships none and an Application cannot sync without a project (`InvalidSpecError: project default which does not exist`).
- **Polling every 20 s.** `make argocd` sets `timeout.reconciliation` to 20 s (the default is 3 minutes); `make refresh` forces an immediate re-read, which `make release` and `make revert` use. On a real setup you would use a git webhook.
- **Ports.** The ALB listener is 86, published as host port 8095 by `docker-compose.yml`.
- **`make rollout` needs the local images** of the current commit (`plant/<svc>:$IMAGE_TAG`); after a rebase the commit changes, so pass `IMAGE_TAG=<the tag the cluster runs>`.
