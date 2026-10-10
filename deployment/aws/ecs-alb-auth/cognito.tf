# Sign-in at the load balancer: a Cognito user pool with a hosted login page (the domain) and one app
# client that belongs to the ALB, not to the browser. The app behind the ALB never sees a password or a token
# it has to check: the ALB signs people in and keeps the session in its own cookie.

resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

# The hosted UI: Cognito's own login page. The ALB sends visitors without a session here.
resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

locals {
  app_origin = var.on_floci ? "http://localhost:${var.alb_host_port}" : var.public_url
  # Real AWS: the ALB's own path, no app route needed. Floci: oauth2-proxy's callback (proxy.tf).
  callback_url = var.on_floci ? "${local.app_origin}/oauth2/callback" : "${local.app_origin}/oauth2/idpresponse"
}

# A confidential client: the ALB keeps the secret and runs the authorization-code flow on the server side.
# (ecs-cognito's client is public and has no secret, because the browser app uses it.)
resource "aws_cognito_user_pool_client" "alb" {
  name         = "${var.name}-alb"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [local.callback_url]
  logout_urls                          = ["${local.app_origin}/"] # where the hosted UI's /logout may send people back

  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user" "demo" {
  for_each     = var.demo_users
  user_pool_id = aws_cognito_user_pool.main.id
  username     = each.key
  password     = var.demo_password

  attributes = {
    email          = each.key
    email_verified = "true"
  }
}

# Real AWS: the hosted login in Plant Parent colours (classic hosted UI; only these -customizable classes are
# allowed). Floci has no hosted-UI branding; there the frontend serves Floci's login page with signin/signin.css.
resource "aws_cognito_user_pool_ui_customization" "brand" {
  count        = var.on_floci ? 0 : 1
  user_pool_id = aws_cognito_user_pool_domain.main.user_pool_id
  client_id    = aws_cognito_user_pool_client.alb.id
  css          = <<-CSS
    .background-customizable { background-color: #f6faf6; }
    .banner-customizable { background-color: #f6faf6; padding: 24px 0 8px; }
    .label-customizable { font-weight: 500; color: #1f2d24; }
    .textDescription-customizable { color: #5b6b60; }
    .inputField-customizable { border-radius: 12px; border: 1px solid #d9e5dc; height: 44px; }
    .inputField-customizable:focus { border-color: #16a34a; }
    .submitButton-customizable { background-color: #16a34a; border-radius: 999px; height: 46px; font-weight: 600; }
    .submitButton-customizable:hover { background-color: #15803d; }
    .errorMessage-customizable { color: #b91c1c; background-color: #fef2f2; border: 0; border-radius: 10px; }
  CSS
}
