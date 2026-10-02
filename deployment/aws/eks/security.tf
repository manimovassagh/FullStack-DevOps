# Chain: internet → alb → worker nodes (NodePorts) → db.
# Unlike ECS awsvpc, pods share their node's security group here (the default
# for EKS); "security groups for pods" exists but needs the VPC CNI's trunk ENIs.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP into the load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "cluster" {
  name        = "${var.name}-cluster"
  description = "EKS control plane and worker nodes"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres, only from the worker nodes"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = var.alb_listener_port
  to_port           = var.alb_listener_port
}

resource "aws_vpc_security_group_ingress_rule" "nodeports_from_alb" {
  security_group_id            = aws_security_group.cluster.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = min(values(var.node_ports)...)
  to_port                      = max(values(var.node_ports)...)

  # Floci reports the reference as "<account>/sg-…", which would show as a change on every plan.
  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

# Nodes and the control plane talk to each other freely (kubelet, webhooks, pod-to-pod).
resource "aws_vpc_security_group_ingress_rule" "cluster_self" {
  security_group_id            = aws_security_group.cluster.id
  referenced_security_group_id = aws_security_group.cluster.id
  ip_protocol                  = "-1"

  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_nodes" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.cluster.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432

  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

# Nodes need egress to pull images, reach the API server, S3 and RDS.
resource "aws_vpc_security_group_egress_rule" "all" {
  for_each = {
    alb     = aws_security_group.alb.id
    cluster = aws_security_group.cluster.id
  }
  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
