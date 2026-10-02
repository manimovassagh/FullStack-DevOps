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

output "preview_url" {
  description = "Always routes to green: test a candidate here before it gets any user traffic."
  value       = "http://localhost:${var.alb_preview_host_port}"
}

output "target_group_arns" {
  description = "Target group ARNs by environment and tier, for `make health`."
  value       = { for k, tg in aws_lb_target_group.app : k => tg.arn }
}

output "release" {
  description = "The release state this apply produced."
  value = {
    blue_tag     = var.blue_tag
    green_tag    = coalesce(var.green_tag, var.blue_tag)
    blue_count   = var.blue_count
    green_count  = var.green_count
    green_weight = var.green_weight
  }
}
