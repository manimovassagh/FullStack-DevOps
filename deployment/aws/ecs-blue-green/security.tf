# Chain: internet → alb → frontend/backend tasks → db. Each tier only accepts the tier in front of it.
# With awsvpc networking every task gets its own ENI, so security groups apply per task, not per host.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP into the load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "frontend" {
  name        = "${var.name}-frontend"
  description = "nginx tasks, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "backend" {
  name        = "${var.name}-backend"
  description = "Go API tasks, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres, only from backend tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each          = { public = var.alb_listener_port, preview = var.alb_preview_port }
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = each.value
  to_port           = each.value
}

locals {
  app_tiers = {
    frontend = { sg = aws_security_group.frontend.id, port = 80 }
    backend  = { sg = aws_security_group.backend.id, port = 8080 }
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  for_each                     = local.app_tiers
  security_group_id            = each.value.sg
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port

  # Floci reports the reference as "<account>/sg-…", which would show as a change on every plan.
  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_backend" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.backend.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432

  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

# Tasks need egress to pull images from ECR, read the secret and reach S3/RDS.
resource "aws_vpc_security_group_egress_rule" "all" {
  for_each = {
    alb      = aws_security_group.alb.id
    frontend = aws_security_group.frontend.id
    backend  = aws_security_group.backend.id
  }
  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
