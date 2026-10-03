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

locals {
  tiers = {
    backend = {
      port           = 8080
      template       = "backend.sh.tftpl"
      template_extra = { artifact_hash = local.backend_hash, media_bucket = aws_s3_bucket.media.id, db_secret_name = local.db_secret_name }
      sg             = aws_security_group.backend.id
      target_group   = aws_lb_target_group.backend.arn
    }
    frontend = {
      port           = 80
      template       = "frontend.sh.tftpl"
      template_extra = { artifact_hash = local.frontend_hash }
      sg             = aws_security_group.frontend.id
      target_group   = aws_lb_target_group.frontend.arn
    }
  }
}

# A launch template is the recipe for one kind of instance (AMI, size, profile, security group, user data).
# Every change creates a new numbered version; the Auto Scaling Group launches from `$Latest`.
resource "aws_launch_template" "app" {
  for_each      = local.tiers
  name          = "${var.name}-${each.key}"
  image_id      = var.ami_id
  instance_type = var.instance_type
  key_name      = aws_key_pair.main.key_name

  iam_instance_profile {
    name = aws_iam_instance_profile.app[each.key].name
  }

  vpc_security_group_ids = [each.value.sg]

  # IMDSv2 only: credentials need a session token, which blocks SSRF-style metadata theft.
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  # Encrypted root volume on real AWS. Floci has no EBS root volume, and the block makes the
  # provider look up the AMI's root device, which Floci's alias AMI can't answer.
  dynamic "block_device_mappings" {
    for_each = var.on_floci ? [] : [1]
    content {
      device_name = "/dev/sda1"
      ebs {
        encrypted = true
      }
    }
  }

  # Launch templates take user data base64-encoded.
  user_data = base64encode(join("\n", [
    local.bootstrap,
    templatefile("${path.module}/templates/${each.value.template}", merge(local.template_vars, each.value.template_extra)),
    "# release: ${var.release}",
  ]))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.name}-${each.key}" }
  }

  # The instances read these at boot, so they must exist first.
  depends_on = [aws_iam_role_policy.app]

  # Floci does not store launch-template tags, so default_tags would show as a change on every plan.
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

# An Auto Scaling Group keeps `desired_capacity` instances running, replaces unhealthy ones, and registers each
# with its ALB target group. ELB health checks mean "unhealthy in the target group" also counts as unhealthy here.
resource "aws_autoscaling_group" "app" {
  for_each            = local.tiers
  name                = "${var.name}-${each.key}"
  min_size            = var.asg_sizes.min
  desired_capacity    = var.asg_sizes.desired
  max_size            = var.asg_sizes.max
  vpc_zone_identifier = [for s in aws_subnet.app : s.id]
  target_group_arns   = [each.value.target_group]

  health_check_type         = "ELB"
  health_check_grace_period = 300 # the user data needs a minute or two before the app answers

  launch_template {
    id      = aws_launch_template.app[each.key].id
    version = "$Latest"
  }

  # Groups are replaced by `make roll`, not by Terraform: ignore the capacity the group is steered to at runtime.
  lifecycle {
    ignore_changes = [desired_capacity]
  }

  depends_on = [aws_s3_object.backend, aws_s3_object.frontend, aws_secretsmanager_secret_version.db, aws_iam_role_policy.app]
}

# Scale on average CPU. Declared for the lesson; Floci stores the policy but does not feed it metrics.
resource "aws_autoscaling_policy" "cpu" {
  for_each               = local.tiers
  name                   = "${var.name}-${each.key}-cpu"
  autoscaling_group_name = aws_autoscaling_group.app[each.key].name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60
  }

  # Floci reports enabled=false and a default cooldown, which the provider would try to reset on every plan.
  lifecycle {
    ignore_changes = [enabled, cooldown]
  }
}
