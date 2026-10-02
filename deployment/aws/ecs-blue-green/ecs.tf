resource "aws_ecs_cluster" "main" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["backend", "frontend"])
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = 7
}

locals {
  colors_cfg = {
    blue  = { tag = var.blue_tag, count = var.blue_count }
    green = { tag = coalesce(var.green_tag, var.blue_tag), count = var.green_count }
  }

  log_configuration = {
    for k, g in aws_cloudwatch_log_group.app : k => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = g.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = k
      }
    }
  }

  # Everything that differs between the backend and frontend containers.
  container_extras = {
    backend = {
      environment = [
        { name = "PORT", value = "8080" },
        { name = "S3_BUCKET", value = aws_s3_bucket.media.id },
        { name = "AWS_REGION", value = var.region },
      ]
      # Injected by ECS at start using the execution role; never in Terraform outputs or the image.
      secrets = [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }]
    }
    frontend = {}
  }

  security_groups = {
    backend  = aws_security_group.backend.id
    frontend = aws_security_group.frontend.id
  }
}

# One task definition per environment and tier: blue and green can run different image tags at the same time.
resource "aws_ecs_task_definition" "app" {
  for_each                 = local.units
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = each.value.tier == "backend" ? aws_iam_role.backend_task.arn : null

  container_definitions = jsonencode([merge({
    name             = each.value.tier
    image            = "${aws_ecr_repository.app[each.value.tier].repository_url}:${local.colors_cfg[each.value.color].tag}"
    essential        = true
    portMappings     = [{ containerPort = each.value.port, hostPort = each.value.port, protocol = "tcp" }] # awsvpc: hostPort = containerPort
    logConfiguration = local.log_configuration[each.value.tier]
  }, local.container_extras[each.value.tier])])

  # The backend task can't connect before the secret holds a value.
  depends_on = [aws_secretsmanager_secret_version.database_url]

  # Floci does not store task-definition tags; without this every plan would replace the task definition.
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

# A service keeps `desired_count` tasks running and registers each one with its target group.
# Four services: blue-backend, blue-frontend, green-backend, green-frontend. Green runs 0 tasks until a release.
resource "aws_ecs_service" "app" {
  for_each        = local.units
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app[each.key].arn
  desired_count   = local.colors_cfg[each.value.color].count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for s in aws_subnet.app : s.id]
    security_groups  = [local.security_groups[each.value.tier]]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app[each.key].arn
    container_name   = each.value.tier
    container_port   = each.value.port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http, aws_lb_listener.preview]
}
