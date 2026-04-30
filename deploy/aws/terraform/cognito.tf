# ---------------------------------------------------------------------------
# Cognito User Pool – OAuth2/OIDC front-door for the AgentCore MCP runtime
# ---------------------------------------------------------------------------
# AgentCore automatically wires its MCP runtime to an OIDC provider.
# We create the Cognito resources here so they are fully managed by
# Terraform and can be referenced both by AgentCore and the token helper
# script.

resource "aws_cognito_user_pool" "mcp" {
  name = var.cognito_user_pool_name

  # ---- Sign-in configuration ----
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # ---- Password policy ----
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # ---- MFA (optional – disabled for simplicity, enable for production) ----
  mfa_configuration = "OFF"

  # ---- Account recovery ----
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # ---- Token validity ----
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }
}

# Cognito domain – required to expose the OAuth2 token endpoint
resource "aws_cognito_user_pool_domain" "mcp" {
  domain       = "${var.cognito_user_pool_name}-${local.account_id}"
  user_pool_id = aws_cognito_user_pool.mcp.id
}

# App client used by the AgentCore runtime and the token helper script
resource "aws_cognito_user_pool_client" "mcp" {
  name         = "${var.agentcore_runtime_name}-client"
  user_pool_id = aws_cognito_user_pool.mcp.id

  # ---- OAuth2 flows ----
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_scopes                 = ["openid", "profile", "email"]

  # Callback / sign-out URLs (adjust for your application)
  callback_urls = ["https://localhost/callback"]
  logout_urls   = ["https://localhost/logout"]

  # Explicit auth flows – enables USER_PASSWORD_AUTH for the token script
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  # Token validity
  access_token_validity  = 60   # minutes
  id_token_validity      = 60   # minutes
  refresh_token_validity = 30   # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
  generate_secret               = false
}

# ---------------------------------------------------------------------------
# Test user – used by the get_token.py helper script
# ---------------------------------------------------------------------------

resource "aws_cognito_user" "test_user" {
  user_pool_id = aws_cognito_user_pool.mcp.id
  # User pool uses email as the username attribute — must pass an email address
  username     = var.cognito_test_user_email

  attributes = {
    email          = var.cognito_test_user_email
    email_verified = "true"
  }

  # Temporary password; the helper script handles the NEW_PASSWORD_REQUIRED
  # challenge automatically on first use.
  temporary_password = var.cognito_test_user_password
}
