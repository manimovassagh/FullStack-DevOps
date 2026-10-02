output "app_url" {
  description = "Open this in the browser. The ALB DNS name does not resolve locally, so we use the published port."
  value       = "http://localhost:${var.alb_host_port}"
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "cluster" {
  value = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "media_bucket" {
  value = aws_s3_bucket.media.id
}

output "database_secret_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}

output "backend_role_arn" {
  description = "IRSA role annotated on the backend ServiceAccount."
  value       = aws_iam_role.backend.arn
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "target_group_arns" {
  value = { for k, tg in aws_lb_target_group.app : k => tg.arn }
}

output "node_ports" {
  value = var.node_ports
}

output "kubectl_access_key" {
  description = "Access key `make kubeconfig` writes into build/kubeconfig for `aws eks get-token`."
  value       = { id = aws_iam_access_key.kubectl.id, secret = aws_iam_access_key.kubectl.secret }
  sensitive   = true
}
