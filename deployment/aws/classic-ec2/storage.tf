resource "aws_s3_bucket" "media" {
  bucket        = "${var.name}-media"
  force_destroy = true # local learning stack; never on real data
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.name}-artifacts"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = { media = aws_s3_bucket.media.id, artifacts = aws_s3_bucket.artifacts.id }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  # Content hashes, not tarball hashes: tar embeds mtimes, so rebuilding the
  # same code would otherwise replace the frontend instance on every apply.
  backend_hash  = filemd5("${var.build_dir}/plant-api")
  frontend_hash = md5(join("", [for f in sort(fileset(var.frontend_dist_dir, "**")) : "${f}:${filemd5("${var.frontend_dist_dir}/${f}")}"]))
}

resource "aws_s3_object" "backend" {
  bucket      = aws_s3_bucket.artifacts.id
  key         = "backend/plant-api"
  source      = "${var.build_dir}/plant-api"
  source_hash = local.backend_hash
}

resource "aws_s3_object" "frontend" {
  bucket      = aws_s3_bucket.artifacts.id
  key         = "frontend/dist.tar.gz"
  source      = "${var.build_dir}/dist.tar.gz"
  source_hash = local.frontend_hash
}
