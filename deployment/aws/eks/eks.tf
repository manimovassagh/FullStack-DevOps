# The control plane. EKS runs the Kubernetes API server and etcd for you; you
# only choose the version, the subnets it attaches to and who may log in.
resource "aws_eks_cluster" "main" {
  name     = var.name
  version  = var.kubernetes_version
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    subnet_ids              = [for s in aws_subnet.app : s.id]
    security_group_ids      = [aws_security_group.cluster.id]
    endpoint_private_access = true
    endpoint_public_access  = true # kubectl from your machine
    public_access_cidrs     = var.kubectl_allowed_cidrs
  }

  # Envelope encryption: Kubernetes Secrets (like DATABASE_URL) are encrypted in etcd with this KMS key.
  encryption_config {
    resources = ["secrets"]
    provider {
      key_arn = aws_kms_key.eks.arn
    }
  }

  # Access entries (IAM principal → cluster permissions) instead of the old aws-auth ConfigMap.
  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  depends_on = [aws_iam_role_policy_attachment.cluster]

  # Floci does not return these two, so every plan would try to add them again.
  lifecycle {
    ignore_changes = [enabled_cluster_log_types, encryption_config]
  }
}

resource "aws_kms_key" "eks" {
  description             = "${var.name} Kubernetes secrets encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

# Worker nodes: an Auto Scaling group of EC2 instances that join the cluster.
# Pods (frontend, backend) are scheduled onto these nodes by Kubernetes.
resource "aws_eks_node_group" "app" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "app"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = [for s in aws_subnet.app : s.id]
  instance_types  = ["t3.medium"]

  scaling_config {
    desired_size = 2
    min_size     = 1
    max_size     = 3
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [aws_iam_role_policy_attachment.node]
}

# Who may use kubectl. With authentication_mode = "API", access is granted by
# access entries (IAM principal → Kubernetes permissions) managed through the EKS API.
resource "aws_iam_user" "kubectl" {
  name = "${var.name}-kubectl"
}

# Local learning stack only: the secret lands in Terraform state. On real AWS
# you would use your SSO role here, not a long-lived access key.
resource "aws_iam_access_key" "kubectl" {
  user = aws_iam_user.kubectl.name
}

# Floci 2.1.0 has no access-entry API and maps every IAM user to cluster-admin,
# so these two are only created on real AWS.
resource "aws_eks_access_entry" "kubectl" {
  count         = var.on_floci ? 0 : 1
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_user.kubectl.arn
}

resource "aws_eks_access_policy_association" "kubectl_admin" {
  count         = var.on_floci ? 0 : 1
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_user.kubectl.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.kubectl]
}
