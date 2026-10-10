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

# Optional sign-in: everyone can browse, signing in is a click away, and only changes need a session.
#
#   real AWS (HTTPS :443)                         Floci (HTTP :80, see FLOCI-NOTES.md)
#   default   authenticate "allow" → frontend     default → oauth2-proxy (proxy.tf), which applies the
#   /api/* writes  authenticate "deny" → backend            same three rules and forwards to listener :81
#   /api/*    authenticate "allow" → backend
#   /oauth2/start  authenticate "authenticate" → redirect /
#
# "allow" forwards a visitor without a session as they are, and a signed-in one with their identity
# (x-amzn-oidc-* headers). "deny" answers 401: a fetch() cannot follow a redirect to another origin.
locals {
  cognito = {
    user_pool_arn       = aws_cognito_user_pool.main.arn
    user_pool_client_id = aws_cognito_user_pool_client.alb.id
    user_pool_domain    = aws_cognito_user_pool_domain.main.domain
  }
  aws_rules = var.on_floci ? {} : {
    signin = { priority = 5, paths = ["/oauth2/start"], methods = [], on_unauth = "authenticate" }
    writes = { priority = 10, paths = ["/api/*"], methods = ["POST", "PUT", "PATCH", "DELETE"], on_unauth = "deny" }
    reads  = { priority = 20, paths = ["/api/*"], methods = [], on_unauth = "allow" }
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.on_floci ? var.alb_listener_port : 443
  protocol          = var.on_floci ? "HTTP" : "HTTPS"
  certificate_arn   = var.on_floci ? null : var.certificate_arn
  ssl_policy        = var.on_floci ? null : "ELBSecurityPolicy-TLS13-1-2-2021-06"

  dynamic "default_action" {
    for_each = var.on_floci ? [] : [1]
    content {
      type  = "authenticate-cognito"
      order = 1

      authenticate_cognito {
        user_pool_arn              = local.cognito.user_pool_arn
        user_pool_client_id        = local.cognito.user_pool_client_id
        user_pool_domain           = local.cognito.user_pool_domain
        on_unauthenticated_request = "allow"
        scope                      = "openid email"
        session_timeout            = 3600 # seconds; then the next change asks for a sign-in again
      }
    }
  }

  default_action {
    type             = "forward"
    order            = 2
    target_group_arn = var.on_floci ? aws_lb_target_group.proxy[0].arn : aws_lb_target_group.app["frontend"].arn
  }
}

resource "aws_lb_listener_rule" "aws" {
  for_each     = local.aws_rules
  listener_arn = aws_lb_listener.http.arn
  priority     = each.value.priority

  condition {
    path_pattern {
      values = each.value.paths
    }
  }

  dynamic "condition" {
    for_each = length(each.value.methods) > 0 ? [1] : []
    content {
      http_request_method {
        values = each.value.methods
      }
    }
  }

  action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = local.cognito.user_pool_arn
      user_pool_client_id        = local.cognito.user_pool_client_id
      user_pool_domain           = local.cognito.user_pool_domain
      on_unauthenticated_request = each.value.on_unauth
      scope                      = "openid email"
      session_timeout            = 3600
    }
  }

  # The sign-in link comes back here after the hosted login, with the session cookie set: send it home.
  dynamic "action" {
    for_each = each.key == "signin" ? [1] : []
    content {
      type  = "redirect"
      order = 2
      redirect {
        path        = "/"
        query       = ""
        status_code = "HTTP_302"
      }
    }
  }

  dynamic "action" {
    for_each = each.key == "signin" ? [] : [1]
    content {
      type             = "forward"
      order            = 2
      target_group_arn = aws_lb_target_group.app["backend"].arn
    }
  }
}
