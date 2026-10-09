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
    frontend = { port = 80, health = "/" }
    backend  = { port = 8080, health = "/api/health" }
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

  # Faster task replacement on deploys than the 300 s default.
  deregistration_delay = 10
}

# Every request passes the authenticate action first. No session cookie: pages are redirected to the
# hosted login, API calls get 401 (a fetch() cannot follow a redirect to another origin). Valid session:
# the next action (forward) runs. Real AWS allows this only on an HTTPS listener.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.on_floci ? var.alb_listener_port : 443
  protocol          = var.on_floci ? "HTTP" : "HTTPS"
  certificate_arn   = var.on_floci ? null : var.certificate_arn
  ssl_policy        = var.on_floci ? null : "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = aws_cognito_user_pool.main.arn
      user_pool_client_id        = aws_cognito_user_pool_client.alb.id
      user_pool_domain           = aws_cognito_user_pool_domain.main.domain
      on_unauthenticated_request = "authenticate"
      scope                      = "openid email"
      session_timeout            = 3600 # seconds; the ALB then sends the user through the login again
    }
  }

  default_action {
    type             = "forward"
    order            = 2
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
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = aws_cognito_user_pool.main.arn
      user_pool_client_id        = aws_cognito_user_pool_client.alb.id
      user_pool_domain           = aws_cognito_user_pool_domain.main.domain
      on_unauthenticated_request = "deny" # 401 instead of a redirect
      scope                      = "openid email"
      session_timeout            = 3600
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.app["backend"].arn
  }
}
