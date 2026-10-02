# Floci notes for the EKS stage

Verified against Floci 2.1.0 (pinned in docker-compose) with k3s `v1.34.12-k3s1`.

## What works like real AWS

- **The cluster is real Kubernetes.** Each EKS cluster is a k3s container (`floci-eks-<name>`). Its API server is published on a host port (6500+), and `aws eks update-kubeconfig` points kubectl at it.
- **`aws eks get-token` authentication.** The kubeconfig's exec plugin signs an STS `GetCallerIdentity` URL, and Floci's token webhook checks the signature. Floci **rejects the shared `test`/`test` key** here, because a valid token means cluster-admin. That's why Terraform creates the `plant-eks-kubectl` IAM user and access key, and `make kubeconfig` pins them in `build/kubeconfig`.
- **ECR pulls.** Floci injects a registry mirror into k3s, so pods pull `000000000000.dkr.ecr.us-east-1.localhost:4566/...` images with no pull secret.
- **Deployments, rollouts, probes, NodePorts** are plain Kubernetes.

## Differences

- **One node.** The k3s container is the control plane *and* the only node. `aws_eks_node_group` is metadata only: `desired_size = 2` creates no extra nodes.
- **Node address.** k3s reports its InternalIP on Docker's default bridge (`172.17.x`), which the ALB inside the Floci container can't reach. `scripts/register-nodes.sh` therefore uses the k3s container's address on the compose network when `FLOCI_NETWORK` is set (the Makefile sets it). On real AWS it registers the node InternalIPs as-is.
- **Access entries.** Floci 2.1.0 has no access-entry API and maps every IAM user to cluster-admin. `aws_eks_access_entry` and the policy association are skipped while `var.on_floci = true`.
- **IRSA is declared, not used.** The OIDC provider, the role and the ServiceAccount annotation exist, but nothing injects web-identity tokens into pods. Instead the Floci-only Secret `aws-local` (`AWS_ENDPOINT_URL` plus static keys, `envFrom` with `optional: true`) gives the backend access to S3. Floci's own address inside the cluster is the RDS proxy host, which is where `make secrets` reads it from.
- **Encryption and log types are metadata.** Floci accepts `encryption_config` and `enabled_cluster_log_types` but doesn't return them, and has no `UpdateClusterConfig`. Both are in `ignore_changes`. k3s does not KMS-encrypt etcd.
- **No AWS Load Balancer Controller.** `scripts/register-nodes.sh` stands in for it.

## Docker network

`FLOCI_SERVICES_EKS_DOCKER_NETWORK` (docker-compose) puts the k3s container on the compose network. On that network the ALB reaches the NodePorts, and pods reach RDS and S3 through Floci.
