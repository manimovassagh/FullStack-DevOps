resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]

  drop_invalid_header_fields = true # reject malformed headers (request smuggling)
}

# The ALB forwards to the NodePort of each Kubernetes Service on every node
# ("instance mode"). Targets are registered by scripts/register-nodes.sh, which
# plays the part of the AWS Load Balancer Controller (TargetGroupBinding).
resource "aws_lb_target_group" "app" {
  for_each = {
    frontend = { health = "/" }
    backend  = { health = "/api/health" }
  }
  name        = "${var.name}-${each.key}"
  port        = var.node_ports[each.key]
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = each.value.health
    matcher             = "200"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 10
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["frontend"].arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["backend"].arn
  }
}
