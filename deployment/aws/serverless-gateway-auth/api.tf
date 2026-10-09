# API Gateway HTTP API: the public front of the function. CloudFront sends /api/* here.
#
# The difference from serverless-cognito: the GATEWAY checks the Cognito token before the function runs.
# A request with no token or a bad token gets 401 from API Gateway itself ({"message":"Unauthorized"});
# the Lambda is never invoked and never billed for it. The function still verifies the token too
# (defence in depth: it is the same backend-serverless-auth), so a misconfigured route cannot open the data.

resource "aws_apigatewayv2_api" "main" {
  name          = var.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.live.invoke_arn
  payload_format_version = "2.0" # the event shape cmd/lambda/adapter.go understands
}

# Checks the Authorization: Bearer <access token> header: signature against the pool's JWKS, expiry,
# issuer, and that the token was issued to this app client (Cognito access tokens carry client_id, which
# API Gateway accepts in place of aud).
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = local.cognito_issuer
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

# Open routes: what a visitor needs before having a token. API Gateway picks the most specific match,
# so these win over the catch-all below.
resource "aws_apigatewayv2_route" "open" {
  for_each = toset([
    "GET /api/health",         # CloudFront and the smoke tests poll it
    "POST /api/auth/{proxy+}", # login, refresh (reads the HttpOnly cookie), logout
  ])
  api_id    = aws_apigatewayv2_api.main.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# Everything else (plants, media, GET /api/auth/me) needs a valid token at the gateway.
resource "aws_apigatewayv2_route" "protected" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "ANY /api/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "live" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "live"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
