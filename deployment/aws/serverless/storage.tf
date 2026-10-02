# Two buckets, two jobs: user uploads (written by the function) and the React build
# (written by `make site`, read only by CloudFront).

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

# The files themselves are not Terraform's job: the pipeline deploys the React build with
# `make site` (aws s3 sync + a CloudFront invalidation), the way a real frontend release works.

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
