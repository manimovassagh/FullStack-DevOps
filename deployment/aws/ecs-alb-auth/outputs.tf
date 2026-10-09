output "app_url" {
  description = "Open this in the browser. The ALB DNS name does not resolve locally, so we use the published port."
  value       = "http://localhost:${var.alb_host_port}"
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "media_bucket" {
  value = aws_s3_bucket.media.id
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "backend_target_group_arn" {
  value = aws_lb_target_group.app["backend"].arn
}

output "frontend_target_group_arn" {
  value = aws_lb_target_group.app["frontend"].arn
}
output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_hosted_ui" {
  description = "Where the ALB sends visitors without a session."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}
