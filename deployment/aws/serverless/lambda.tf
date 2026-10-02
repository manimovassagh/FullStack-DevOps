locals {
  # A function container reaches Floci at the address RDS reports (same Docker network);
  # `localhost` would be the container itself. On real AWS no endpoint override exists.
  aws_endpoint = var.on_floci ? { AWS_ENDPOINT_URL = "http://${aws_db_instance.main.address}:4566" } : {}
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = 7
}

resource "aws_lambda_function" "api" {
  function_name = "${var.name}-api"
  role          = aws_iam_role.lambda.arn
  runtime       = "provided.al2023" # Go compiles to a native `bootstrap` binary; no managed Go runtime exists
  handler       = "bootstrap"
  architectures = [var.lambda_architecture]

  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)

  memory_size = 256
  timeout     = 20
  # Every code or configuration change creates an immutable numbered version; the alias below points at one.
  publish = true

  vpc_config {
    subnet_ids         = [for s in aws_subnet.lambda : s.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = merge({
      S3_BUCKET           = aws_s3_bucket.media.id
      DATABASE_SECRET_ARN = aws_secretsmanager_secret.database_url.arn
      # The request payload limit is 6 MB and the body arrives base64-encoded (+33%), so uploads cap at 4 MB.
      MAX_UPLOAD_BYTES = "4194304"
      RELEASE          = var.release
    }, local.aws_endpoint)
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.vpc_access, aws_iam_role_policy.api]
}

# API Gateway invokes the alias, never $LATEST: moving the alias is the deployment.
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}
