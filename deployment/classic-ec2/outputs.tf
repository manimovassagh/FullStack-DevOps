output "app_url" {
  description = "Open this in the browser. The ALB DNS name does not resolve locally, so we use the published port."
  value       = "http://localhost:${var.alb_host_port}"
}

output "alb_dns_name" {
  description = "What you would CNAME on real AWS. Locally, use app_url."
  value       = aws_lb.main.dns_name
}

output "media_bucket" {
  value = aws_s3_bucket.media.id
}

output "backend_instance_id" {
  value = aws_instance.backend.id
}

output "frontend_instance_id" {
  value = aws_instance.frontend.id
}

output "backend_target_group_arn" {
  value = aws_lb_target_group.backend.arn
}

output "frontend_target_group_arn" {
  value = aws_lb_target_group.frontend.arn
}
