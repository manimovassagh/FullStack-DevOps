# Terraform generates the SSH key; the private half is only written locally.
resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "local_sensitive_file" "ssh_key" {
  content         = tls_private_key.ssh.private_key_openssh
  filename        = "${var.build_dir}/ssh/id_rsa"
  file_permission = "0600"
}

resource "aws_key_pair" "main" {
  key_name   = var.name
  public_key = tls_private_key.ssh.public_key_openssh

  # Floci does not store key-pair tags, so default_tags would show as a change on every plan.
  lifecycle {
    ignore_changes = [tags_all]
  }
}

locals {
  template_vars = {
    region                = var.region
    instance_aws_endpoint = var.instance_aws_endpoint
    artifacts_bucket      = aws_s3_bucket.artifacts.id
    use_systemd           = var.use_systemd
  }
  bootstrap = file("${path.module}/templates/bootstrap.sh")
}

resource "aws_instance" "backend" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app["a"].id
  vpc_security_group_ids      = [aws_security_group.backend.id]
  iam_instance_profile        = aws_iam_instance_profile.app["backend"].name
  key_name                    = aws_key_pair.main.key_name
  user_data_replace_on_change = true # new artifact hash → new instance

  # IMDSv2 only: credentials need a session token, which blocks SSRF-style metadata theft.
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted = true
  }

  user_data = join("\n", [local.bootstrap, templatefile("${path.module}/templates/backend.sh.tftpl", merge(local.template_vars, {
    artifact_hash  = local.backend_hash
    media_bucket   = aws_s3_bucket.media.id
    db_secret_name = local.db_secret_name
  }))])

  # The instance reads these at boot, so they must exist first.
  depends_on = [aws_s3_object.backend, aws_secretsmanager_secret_version.db, aws_iam_role_policy.app]
  tags       = { Name = "${var.name}-backend" }
}

resource "aws_instance" "frontend" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app["a"].id
  vpc_security_group_ids      = [aws_security_group.frontend.id]
  iam_instance_profile        = aws_iam_instance_profile.app["frontend"].name
  key_name                    = aws_key_pair.main.key_name
  user_data_replace_on_change = true

  # IMDSv2 only: credentials need a session token, which blocks SSRF-style metadata theft.
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted = true
  }

  user_data = join("\n", [local.bootstrap, templatefile("${path.module}/templates/frontend.sh.tftpl", merge(local.template_vars, {
    artifact_hash = local.frontend_hash
  }))])

  depends_on = [aws_s3_object.frontend, aws_iam_role_policy.app]
  tags       = { Name = "${var.name}-frontend" }
}
