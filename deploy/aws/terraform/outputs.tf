output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.mcp_server.repository_url
}

output "ecr_image_uri" {
  description = "Full ECR image URI that was built and pushed"
  value       = local.ecr_image_uri
}

output "agentcore_execution_role_arn" {
  description = "IAM execution role ARN used by the AgentCore runtime"
  value       = aws_iam_role.agentcore_execution.arn
}

output "agentcore_runtime_id" {
  description = "Bedrock AgentCore runtime ID"
  value       = aws_bedrockagentcore_agent_runtime.mcp.agent_runtime_id
}

output "agentcore_runtime_arn" {
  description = "Bedrock AgentCore runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.mcp.agent_runtime_arn
}

output "agentcore_log_group" {
  description = "CloudWatch log group for AgentCore runtime invocation logs"
  value       = aws_cloudwatch_log_group.agentcore_invocations.name
}

output "agentcore_invocation_url" {
  description = "URL for invoking the AgentCore runtime"
  value       = "https://bedrock-agentcore.${local.region}.amazonaws.com/runtimes/${urlencode(aws_bedrockagentcore_agent_runtime.mcp.agent_runtime_arn)}/invocations?qualifier=DEFAULT"
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.mcp.id
}

output "cognito_user_pool_client_id" {
  description = "Cognito app client ID"
  value       = aws_cognito_user_pool_client.mcp.id
}

# output "cognito_token_endpoint" {
#   description = "Cognito OAuth2 token endpoint"
#   value       = local.token_endpoint
# }

# output "cognito_jwks_uri" {
#   description = "Cognito JWKS URI (used by AgentCore to verify tokens)"
#   value       = local.jwks_uri
# }

output "cognito_test_username" {
  description = "Cognito test user username (email)"
  value       = var.cognito_test_user_email
}

output "get_token_command" {
  description = "Command to generate an OAuth token for the test user"
  value       = <<-EOT
    python3 scripts/get_token.py \
      --region ${local.region} \
      --user-pool-id ${aws_cognito_user_pool.mcp.id} \
      --client-id ${aws_cognito_user_pool_client.mcp.id} \
      --username ${var.cognito_test_username} \
      --password <PASSWORD>
  EOT
}
