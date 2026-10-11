output "app_url" {
  description = "Open this in the browser. HTTPS always: CloudFront on AWS; on Floci the Caddy that terminates TLS in front of the distribution alias."
  value       = var.on_floci ? "https://${var.local_hostname}:${var.tls_port}" : "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "alb_url" {
  description = "The load balancer itself. Only CloudFront may use it: a direct request gets 403."
  value       = var.on_floci ? "http://localhost:${var.alb_host_port}" : "http://${aws_lb.main.dns_name}"
}

output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "site_bucket" {
  value = aws_s3_bucket.site.id
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

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
