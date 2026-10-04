# Every AWS API call goes to Floci. On real AWS you would delete the endpoints
# block, the static keys and the skip_* flags — the resources stay the same.
provider "aws" {
  region     = var.region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    ec2            = var.floci_endpoint
    ecr            = var.floci_endpoint
    ecs            = var.floci_endpoint
    cloudwatchlogs = var.floci_endpoint
    cognitoidp     = var.floci_endpoint
    elbv2          = var.floci_endpoint
    iam            = var.floci_endpoint
    rds            = var.floci_endpoint
    s3             = var.floci_endpoint
    secretsmanager = var.floci_endpoint
    sts            = var.floci_endpoint
  }

  default_tags {
    tags = { Project = "plant-parent", Stage = "ecs-cognito" }
  }
}
