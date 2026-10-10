# Floci only: Floci stores the listener's authenticate-cognito actions but never runs them (FLOCI-NOTES.md),
# so here an oauth2-proxy task does the ALB's sign-in job with the same Cognito pool, client and rules:
#
#   browser ─► ALB :80 ─► oauth2-proxy :4180 ─► ALB :81 (inside Floci) ─┬─ /api/*         → backend
#                          │                                             ├─ /cognito-idp/*  → frontend nginx → Floci (styled login)
#                          │                                             └─ /*              → frontend
#                          ├─ GET anything → passed through, signed in or not
#                          ├─ POST/PUT/PATCH/DELETE without a session → 401 on /api/*
#                          └─ /oauth2/start → hosted login → /oauth2/callback → session cookie
#
# On real AWS (on_floci = false) none of this exists: the listener rules in alb.tf do the same.

locals {
  proxy = var.on_floci ? 1 : 0
  # Inside the compose network the task reaches Floci as "floci"; the browser reaches it on this host port.
  floci_internal = "http://floci:4566"
  # Floci signs tokens with this issuer (its discovery document says so), whatever host fetched them.
  floci_issuer = "http://localhost:4566/${aws_cognito_user_pool.main.id}"
}

resource "random_password" "cookie_secret" {
  length  = 32 # oauth2-proxy needs a 16, 24 or 32 byte key to encrypt its cookie
  special = false
}

resource "aws_secretsmanager_secret" "proxy" {
  for_each                = var.on_floci ? toset(["client-secret", "cookie-secret"]) : toset([])
  name                    = "${var.name}/proxy-${each.key}"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "proxy" {
  for_each      = aws_secretsmanager_secret.proxy
  secret_id     = each.value.id
  secret_string = each.key == "client-secret" ? aws_cognito_user_pool_client.alb.client_secret : random_password.cookie_secret.result
}

# The internal listener the proxy forwards to: the app routing the public listener has on real AWS.
resource "aws_lb_listener" "internal" {
  count             = local.proxy
  load_balancer_arn = aws_lb.main.arn
  port              = 81
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["frontend"].arn
  }
}

resource "aws_lb_listener_rule" "internal_api" {
  count        = local.proxy
  listener_arn = aws_lb_listener.internal[0].arn
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

# Sign out = two sessions: the proxy's cookie and the hosted login's own cookie, which would otherwise sign the
# next "Sign in" straight back in without the form. Two hops, because a redirect's query is at most 128 characters:
#   /signout   → /oauth2/sign_out?rd=/signedout   (proxy cookie gone)
#   /signedout → hosted UI /logout → the app      (hosted-login cookie gone)
locals {
  signout_redirects = var.on_floci ? {
    signout   = { priority = 5, host = "localhost", port = var.alb_host_port, path = "/oauth2/sign_out", query = "rd=%2Fsignedout" }
    signedout = { priority = 6, host = "localhost", port = var.alb_host_port, path = "/cognito-idp/logout", query = "client_id=${aws_cognito_user_pool_client.alb.id}&logout_uri=${urlencode("${local.app_origin}/")}" }
  } : {}
}

resource "aws_lb_listener_rule" "internal_signout" {
  for_each     = local.signout_redirects
  listener_arn = aws_lb_listener.internal[0].arn
  priority     = each.value.priority

  condition {
    path_pattern {
      values = ["/${each.key}"]
    }
  }

  action {
    type = "redirect"
    redirect {
      protocol    = "HTTP"
      host        = each.value.host
      port        = tostring(each.value.port)
      path        = each.value.path
      query       = each.value.query
      status_code = "HTTP_302"
    }
  }
}

resource "aws_lb_target_group" "proxy" {
  count       = local.proxy
  name        = "${var.name}-proxy"
  port        = 4180
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/ping"
    matcher             = "200"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 10
}

resource "aws_security_group" "proxy" {
  count       = local.proxy
  name        = "${var.name}-proxy"
  description = "oauth2-proxy tasks, only from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_alb" {
  count                        = local.proxy
  security_group_id            = aws_security_group.proxy[0].id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 4180
  to_port                      = 4180

  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

resource "aws_vpc_security_group_egress_rule" "proxy_all" {
  count             = local.proxy
  security_group_id = aws_security_group.proxy[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_cloudwatch_log_group" "proxy" {
  count             = local.proxy
  name              = "/ecs/${var.name}/proxy"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "proxy" {
  count                    = local.proxy
  family                   = "${var.name}-proxy"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn

  container_definitions = jsonencode([{
    name         = "proxy"
    image        = "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1"
    essential    = true
    portMappings = [{ containerPort = 4180, hostPort = 4180, protocol = "tcp" }]
    command = [
      "--http-address=0.0.0.0:4180",
      "--reverse-proxy=true",
      "--upstream=http://floci:81/",
      "--provider=oidc",
      "--client-id=${aws_cognito_user_pool_client.alb.id}",
      "--scope=openid email",
      "--email-domain=*",
      # No discovery: its URLs say localhost:4566, which is the task itself. The browser goes to the hosted
      # login on this Floci's host port; the proxy redeems codes and fetches keys inside the compose network.
      "--skip-oidc-discovery=true",
      "--oidc-issuer-url=${local.floci_issuer}",
      "--login-url=${local.app_origin}/cognito-idp/oauth2/authorize", # Floci's login page, styled (signin/nginx.conf)
      "--redeem-url=${local.floci_internal}/cognito-idp/oauth2/token",
      "--oidc-jwks-url=${local.floci_internal}/${aws_cognito_user_pool.main.id}/.well-known/jwks.json",
      "--redirect-url=${local.app_origin}/oauth2/callback",
      "--cookie-name=plant_session",
      "--cookie-secure=false", # plain HTTP on Floci; real AWS is HTTPS
      "--cookie-expire=1h",
      "--skip-provider-button=true",
      # The rules alb.tf gives the real listener: reads are open, changes need a session (401 on the API).
      "--skip-auth-route=GET=^/",
      "--skip-auth-route=HEAD=^/",
      "--skip-auth-route=POST=^/cognito-idp/login$", # the login form itself is posted before there is a session
      "--api-route=^/api/",
    ]
    secrets = [
      { name = "OAUTH2_PROXY_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.proxy["client-secret"].arn },
      { name = "OAUTH2_PROXY_COOKIE_SECRET", valueFrom = aws_secretsmanager_secret.proxy["cookie-secret"].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.proxy[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "proxy"
      }
    }
  }])

  depends_on = [aws_secretsmanager_secret_version.proxy]

  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_ecs_service" "proxy" {
  count           = local.proxy
  name            = "proxy"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.proxy[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for s in aws_subnet.app : s.id]
    security_groups  = [aws_security_group.proxy[0].id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.proxy[0].arn
    container_name   = "proxy"
    container_port   = 4180
  }

  depends_on = [aws_lb_listener.http, aws_lb_listener.internal]
}
