resource "aws_ecs_cluster" "main" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["backend"])
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = 7
}

locals {
  image = { for k, r in aws_ecr_repository.app : k => "${r.repository_url}:${var.image_tag}" }

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
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.name}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn

  container_definitions = jsonencode([{
    name         = "backend"
    image        = local.image["backend"]
    essential    = true
    portMappings = [{ containerPort = 8080, hostPort = 8080, protocol = "tcp" }] # awsvpc: hostPort = containerPort
    environment = [
      { name = "PORT", value = "8080" },
      { name = "S3_BUCKET", value = aws_s3_bucket.media.id },
      { name = "AWS_REGION", value = var.region },
    ]
    # Injected by ECS at start using the execution role; never in Terraform outputs or the image.
    secrets          = [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }]
    logConfiguration = local.log_configuration["backend"]
  }])

  # The task can't connect before the secret holds a value.
  depends_on = [aws_secretsmanager_secret_version.database_url]

  # Floci does not store task-definition tags; without this every plan would replace the task definition.
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

locals {
  services = {
    backend = {
      task_definition = aws_ecs_task_definition.backend.arn
      target_group    = aws_lb_target_group.app["backend"].arn
      security_group  = aws_security_group.backend.id
      port            = 8080
    }
  }
}

# A service keeps `desired_count` tasks running and registers each one with its
# target group (IP targets), replacing tasks when a new task-definition revision arrives.
resource "aws_ecs_service" "app" {
  for_each        = local.services
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = each.value.task_definition
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for s in aws_subnet.app : s.id]
    security_groups  = [each.value.security_group]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = each.value.target_group
    container_name   = each.key
    container_port   = each.value.port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener_rule.api_from_cloudfront]
}
