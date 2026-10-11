# Accounts for the app: an Amazon Cognito user pool people sign up to themselves, one app client for the web
# app and two demo users. The Go API (backend-signup) talks to Cognito for every account step, so the browser
# never calls Cognito directly and never holds a refresh token a script could read.

resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  username_attributes      = ["email"] # people sign in with their email address
  auto_verified_attributes = ["email"] # sign-up emails a code; the account works once the code is entered
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

  # Self-service sign-up: anyone can create an account (SignUp), confirmed by the emailed code.
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # "Forgot password" sends a code to the verified email address.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Plant Parent code"
    email_message        = "Your Plant Parent code is {####}. It expires in 24 hours."
  }

  # Cognito's own sender: fine for a demo (a low daily limit). Production: SES with your domain
  # (email_sending_account = "DEVELOPER" + source_arn). Floci delivers to its SES inbox (GET /_aws/ses).
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Changing the email needs the new address confirmed first; until then the old one keeps working.
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }
}

# A public client: a browser app cannot keep a secret. The API signs people in on its behalf
# (USER_PASSWORD_AUTH, server side) and hands the page only the short-lived access token.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["email", "name"] # what sign-up and the profile page may set

  access_token_validity  = 60 # minutes: "sign out everywhere" reaches other devices within the hour
  id_token_validity      = 60
  refresh_token_validity = 30 # days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation       = true # sign out revokes the refresh token
  prevent_user_existence_errors = "ENABLED"
}

# Demo users for the smoke tests and for trying the app without signing up.
resource "aws_cognito_user" "demo" {
  for_each     = var.demo_users
  user_pool_id = aws_cognito_user_pool.main.id
  username     = each.key
  password     = var.demo_password

  attributes = {
    email          = each.key
    email_verified = "true"
    name           = each.value.name
  }
}

locals {
  # The "iss" claim the tokens carry. Real Cognito: the regional endpoint. Floci: its own address on its internal
  # port (4566), whichever host port the request came through.
  cognito_issuer = var.on_floci ? "http://localhost:4566/${aws_cognito_user_pool.main.id}" : "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
