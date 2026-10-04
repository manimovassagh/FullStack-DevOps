# Sign-in for the app: an Amazon Cognito user pool, one app client for the web app, an "admin" group and
# three demo users. The Go API (backend-auth) never sees a password it stores: Cognito keeps them.

resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  username_attributes      = ["email"] # people sign in with their email address
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF" # real deployments: "OPTIONAL" or "ON" (needs an SMS or TOTP setup)
  deletion_protection      = "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # No self sign-up: an administrator invites people (AdminCreateUser). Opening sign-up is one flag away.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# The web app is a public client: it cannot keep a secret, so it has none. The API signs users in on its
# behalf (USER_PASSWORD_AUTH, server side) and hands the browser only the short-lived access token.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 60 # minutes: a stolen access token stops working within the hour
  id_token_validity      = 60
  refresh_token_validity = 30 # days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation       = true # logout revokes the refresh token
  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Sees every user's plants"
}

# Demo users for the smoke tests and for trying the app. On a real deployment you would create people with
# `aws cognito-idp admin-create-user` or an invitation flow, and never keep a password in Terraform.
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

resource "aws_cognito_user_in_group" "admin" {
  for_each     = { for u, cfg in var.demo_users : u => cfg if cfg.admin }
  user_pool_id = aws_cognito_user_pool.main.id
  group_name   = aws_cognito_user_group.admin.name
  username     = aws_cognito_user.demo[each.key].username
}

locals {
  # The "iss" claim the tokens carry. Real Cognito: the regional endpoint. Floci: its own URL as seen from
  # the host, which is where the tokens were issued.
  cognito_issuer = var.on_floci ? "${var.floci_endpoint}/${aws_cognito_user_pool.main.id}" : "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
