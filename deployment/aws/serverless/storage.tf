# Two buckets, two jobs: user uploads (written by the function) and the React build
# (written by Terraform, read only by CloudFront).

resource "aws_s3_bucket" "media" {
  bucket        = "${var.name}-media"
  force_destroy = true # local learning stack; never on real data
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "site" {
  bucket        = "${var.name}-site"
  force_destroy = true
}

# Private: the bucket is not a website endpoint. Only CloudFront (see cdn.tf) may read it.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  content_types = {
    html  = "text/html"
    js    = "text/javascript"
    css   = "text/css"
    svg   = "image/svg+xml"
    png   = "image/png"
    ico   = "image/x-icon"
    json  = "application/json"
    txt   = "text/plain"
    webp  = "image/webp"
    woff  = "font/woff"
    woff2 = "font/woff2"
  }
  site_files = fileset(var.frontend_dist, "**")
}

resource "aws_s3_object" "site" {
  for_each     = local.site_files
  bucket       = aws_s3_bucket.site.id
  key          = each.value
  source       = "${var.frontend_dist}/${each.value}"
  etag         = filemd5("${var.frontend_dist}/${each.value}")
  content_type = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
  # Vite fingerprints everything under assets/, so it can be cached for a year; index.html must not be.
  cache_control = startswith(each.value, "assets/") ? "public, max-age=31536000, immutable" : "no-cache"
}

# Only this distribution may read the site (origin access control).
data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json
}
