# ---------------------------------------------------------------------------
# Bedrock AgentCore – MCP Runtime (aws native resource)
# ---------------------------------------------------------------------------

locals {
  # Environment variables forwarded to the MCP server container
  mcp_env_raw = {
    # MDB_MCP_LOGGERS                     = "stderr,mcp"
    # MDB_MCP_DISABLED_TOOLS              = "atlas-local"
    # MDB_MCP_EXTERNALLY_MANAGED_SESSIONS = "true"
    # MDB_MCP_HTTP_RESPONSE_TYPE          = "json"
    # MDB_MCP_TRANSPORT                   = "http"
    # MDB_MCP_HTTP_HOST                   = "0.0.0.0"
    # MDB_MCP_HTTP_PORT                   = "8000"
    MDB_MCP_CONNECTION_STRING           = var.mdb_connection_string
    MDB_MCP_API_CLIENT_ID               = var.mdb_api_client_id
    MDB_MCP_API_CLIENT_SECRET           = var.mdb_api_client_secret
  }

  # Strip empty-value entries (e.g. optional Atlas creds not provided)
  mcp_env = { for k, v in local.mcp_env_raw : k => v if v != "" }

  # cognito_domain_url = "https://${aws_cognito_user_pool_domain.mcp.domain}.auth.${local.region}.amazoncognito.com"
  # token_endpoint     = "${local.cognito_domain_url}/oauth2/token"
  # jwks_uri           = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.mcp.id}/.well-known/jwks.json"
  oidc_discovery_url = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.mcp.id}/.well-known/openid-configuration"
}

# ---------------------------------------------------------------------------
# AgentCore MCP runtime – native aws resource
# ---------------------------------------------------------------------------

resource "aws_bedrockagentcore_agent_runtime" "mcp" {
  agent_runtime_name = var.agentcore_runtime_name
  role_arn           = aws_iam_role.agentcore_execution.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = local.ecr_image_uri
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = local.oidc_discovery_url
      allowed_clients = [aws_cognito_user_pool_client.mcp.id]
    }
  }

  environment_variables = local.mcp_env

  depends_on = [
    null_resource.docker_build_push,
    aws_iam_role_policy_attachment.agentcore_ecr,
    aws_iam_role_policy_attachment.agentcore_logs,
    aws_cognito_user_pool_client.mcp,
    aws_cognito_user_pool_domain.mcp,
  ]
}
