# Chain: internet → alb → frontend/backend → db. Each tier only accepts the tier in front of it.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP into the load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "frontend" {
  name        = "${var.name}-frontend"
  description = "nginx, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "backend" {
  name        = "${var.name}-backend"
  description = "Go API, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres, only from the backend"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = var.alb_listener_port
  to_port           = var.alb_listener_port
}

locals {
  app_tiers = {
    frontend = { sg = aws_security_group.frontend.id, port = 80 }
    backend  = { sg = aws_security_group.backend.id, port = 8080 }
  }
}

# Real-AWS style: allow traffic whose source is the ALB's security group.
resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  for_each                     = var.alb_source_cidr == "" ? local.app_tiers : {}
  security_group_id            = each.value.sg
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

# Floci fallback (see FLOCI-NOTES.md): its ALB connects from its own address.
resource "aws_vpc_security_group_ingress_rule" "from_alb_cidr" {
  for_each          = var.alb_source_cidr == "" ? {} : local.app_tiers
  security_group_id = each.value.sg
  cidr_ipv4         = var.alb_source_cidr
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each          = local.app_tiers
  security_group_id = each.value.sg
  cidr_ipv4         = var.ssh_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "db_from_backend" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.backend.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

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
