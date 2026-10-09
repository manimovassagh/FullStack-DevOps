# CloudFront is the one public entrance: one hostname serves the React build from S3 (cached at the edge)
# and forwards /api/* to the load balancer in front of the ECS backend (never cached). The browser sees one
# origin, so there is no CORS and no second domain. This is the most common way to run a single-page app with
# a container API on AWS.

locals {
  # Floci's CloudFront runs in the same process as its ALB listeners, so on Floci the origin is localhost on the
  # listener port. On AWS it is the ALB's DNS name.
  alb_origin_domain = var.on_floci ? "localhost" : aws_lb.main.dns_name

  # AWS-managed policies (the same ids in every account).
  cache_optimized         = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  cache_disabled          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  origin_all_but_host_hdr = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Single-page app routing: /plants/123 is a React Router path, not an S3 key. This function (runs at the edge
# before the cache) serves index.html for every path without a file extension. A distribution-wide
# "404 → index.html" error page would also rewrite the API's real 404s.
resource "aws_cloudfront_function" "spa" {
  count   = var.on_floci ? 0 : 1
  name    = "${var.name}-spa-routing"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      if (request.uri.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  EOT
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  comment             = var.name
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = var.on_floci ? [var.local_hostname] : []

  # Origin 1: the React build in S3, read through origin access control.
  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Origin 2: the load balancer. CloudFront adds the secret header the ALB's listener rule asks for.
  origin {
    origin_id   = "alb"
    domain_name = local.alb_origin_domain
    custom_origin_config {
      http_port              = var.alb_listener_port
      https_port             = 443
      origin_protocol_policy = "http-only" # production: an HTTPS listener with an ACM certificate and "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = var.on_floci ? "allow-all" : "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cache_optimized
    compress               = true

    dynamic "function_association" {
      for_each = aws_cloudfront_function.spa
      content {
        event_type   = "viewer-request"
        function_arn = function_association.value.arn
      }
    }
  }

  ordered_cache_behavior {
    path_pattern             = "api/*"
    target_origin_id         = "alb"
    viewer_protocol_policy   = var.on_floci ? "allow-all" : "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cache_disabled # never cache API responses
    origin_request_policy_id = local.origin_all_but_host_hdr
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Floci stores CloudFront Functions but never runs them, so locally the SPA fallback is an error page instead.
  dynamic "custom_error_response" {
    for_each = var.on_floci ? [403, 404] : []
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # Floci does not store tags on distributions, so the provider's default_tags would show as a change on every plan.
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}
