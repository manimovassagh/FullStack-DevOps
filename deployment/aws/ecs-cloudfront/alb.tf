# The load balancer is not the public entrance here: CloudFront is (cdn.tf). The ALB only serves /api/* to the
# backend tasks, and only when the request carries the secret header CloudFront adds on its way to the origin.
# Anyone who finds the ALB's address and calls it directly gets 403.

resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]

  drop_invalid_header_fields = true # reject malformed headers (request smuggling)
}

# target_type "ip": awsvpc tasks are registered by their own IP, not by an instance.
resource "aws_lb_target_group" "app" {
  for_each = {
    backend = { port = 8080, health = "/api/health" }
  }
  name        = "${var.name}-${each.key}"
  port        = each.value.port
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

# The shared secret between CloudFront and the ALB. Rotating it: add the new value as a second rule, switch
# CloudFront, remove the old rule.
resource "random_password" "origin_verify" {
  length  = 32
  special = false
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  # Everything that is not a CloudFront API request ends here.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden: use the CloudFront address"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "api_from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["backend"].arn
  }
}
