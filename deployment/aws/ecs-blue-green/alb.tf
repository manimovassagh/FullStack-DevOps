resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]

  drop_invalid_header_fields = true # reject malformed headers (request smuggling)
}

# Two environments (blue, green) × two tiers (frontend, backend) = four target groups.
# Each environment has its own ECS services and its own target groups, so the ALB can
# split traffic between whole environments just by changing weights.
locals {
  colors = ["blue", "green"]

  tiers = {
    frontend = { port = 80, health = "/" }
    backend  = { port = 8080, health = "/api/health" }
  }

  # "blue-frontend" => { color = "blue", tier = "frontend", port = 80, … } for every combination
  units = merge([
    for color in local.colors : {
      for tier, t in local.tiers : "${color}-${tier}" => merge(t, { color = color, tier = tier })
    }
  ]...)
}

# target_type "ip": awsvpc tasks are registered by their own IP, not by an instance.
resource "aws_lb_target_group" "app" {
  for_each    = local.units
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

# ── Public listener: weighted between blue and green ─────────────────────────
# The weights are the release: 0 = nobody sees green, 10 = canary, 100 = cut over.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  default_action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.app["blue-frontend"].arn
        weight = 100 - var.green_weight
      }
      target_group {
        arn    = aws_lb_target_group.app["green-frontend"].arn
        weight = var.green_weight
      }
    }
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
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.app["blue-backend"].arn
        weight = 100 - var.green_weight
      }
      target_group {
        arn    = aws_lb_target_group.app["green-backend"].arn
        weight = var.green_weight
      }
    }
  }
}

# ── Preview listener: always green ───────────────────────────────────────────
# What CodeDeploy calls the "test listener": smoke-test the candidate through the real ALB
# before it has any user traffic. (Open it in a browser: http://localhost:<alb_preview_host_port>.)
resource "aws_lb_listener" "preview" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_preview_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["green-frontend"].arn
  }
}

resource "aws_lb_listener_rule" "preview_api" {
  listener_arn = aws_lb_listener.preview.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["green-backend"].arn
  }
}
