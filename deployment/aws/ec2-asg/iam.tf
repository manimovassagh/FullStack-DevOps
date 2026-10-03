locals {
  db_secret_name = "${var.name}/db"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# Backend: its artifact, read/write user media, read the DB secret. Nothing else.
data "aws_iam_policy_document" "backend" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/backend/*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.region}:*:secret:${local.db_secret_name}-*"]
  }
}

# Frontend: only its own artifact.
data "aws_iam_policy_document" "frontend" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/frontend/*"]
  }
}

locals {
  roles = {
    backend  = data.aws_iam_policy_document.backend.json
    frontend = data.aws_iam_policy_document.frontend.json
  }
}

resource "aws_iam_role" "app" {
  for_each           = local.roles
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy" "app" {
  for_each = local.roles
  name     = "${var.name}-${each.key}"
  role     = aws_iam_role.app[each.key].id
  policy   = each.value
}

# An instance profile is the box that hands a role to an EC2 instance (served via IMDS).
resource "aws_iam_instance_profile" "app" {
  for_each = local.roles
  name     = "${var.name}-${each.key}"
  role     = aws_iam_role.app[each.key].name

  # Floci does not store instance-profile tags, so default_tags would show as a change on every plan.
  lifecycle {
    ignore_changes = [tags_all]
  }
}
