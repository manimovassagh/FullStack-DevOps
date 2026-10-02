output "app_url" {
  description = "Open this in the browser."
  value       = var.on_floci ? "http://${var.local_hostname}:${var.floci_port}" : "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "api_id" {
  value = aws_apigatewayv2_api.main.id
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "live_version" {
  description = "The function version the `live` alias points at; changes on every release."
  value       = aws_lambda_alias.live.function_version
}

output "media_bucket" {
  value = aws_s3_bucket.media.id
}

output "site_bucket" {
  value = aws_s3_bucket.site.id
}

output "database_secret_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}
