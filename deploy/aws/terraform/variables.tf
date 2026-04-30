variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use for ECR authentication"
  type        = string
  default     = "default"
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository"
  type        = string
  default     = "mongodb_mcp_server_terraform"
}

variable "image_tag" {
  description = "Docker image tag to build and push"
  type        = string
  default     = "latest"
}

variable "agentcore_runtime_name" {
  description = "Name of the Bedrock AgentCore MCP runtime"
  type        = string
  default     = "mongodb_mcp_server_runtime"
}

variable "cognito_user_pool_name" {
  description = "Name of the Cognito user pool for AgentCore authentication"
  type        = string
  default     = "mongodb-mcp-server-pool-terraform"
}

variable "cognito_test_username" {
  description = "Username for the Cognito test user"
  type        = string
  default     = "mcp-test-user"
}

variable "cognito_test_user_email" {
  description = "Email for the Cognito test user"
  type        = string
}

variable "cognito_test_user_password" {
  description = "Temporary password for the Cognito test user (must meet Cognito password policy)"
  type        = string
  sensitive   = true
}

# MongoDB / Atlas credentials passed to the MCP server at runtime
variable "mdb_connection_string" {
  description = "MongoDB connection string (mongodb:// format; mongodb+srv:// is not supported by AgentCore)"
  type        = string
  sensitive   = true
}

variable "mdb_api_client_id" {
  description = "MongoDB Atlas API client ID (optional, only if Atlas tools are enabled)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "mdb_api_client_secret" {
  description = "MongoDB Atlas API client secret (optional, only if Atlas tools are enabled)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "dockerfile_context_path" {
  description = "Path to the directory containing the Dockerfile (relative to where terraform is run)"
  type        = string
  default     = ".."
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default = {
    Project     = "mongodb-mcp-server"
    ManagedBy   = "terraform"
  }
}
