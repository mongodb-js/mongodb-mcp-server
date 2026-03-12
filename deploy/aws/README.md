# Deploy MongoDB MCP Server on AWS Bedrock AgentCore

## Overview

This directory contains a Dockerfile for deploying the MongoDB MCP Server as an [AWS Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) MCP runtime. The image runs the server over HTTP transport with JSON responses, compatible with AgentCore's managed session model.

## Prerequisites

- AWS CLI (v2) installed and configured (`aws configure`).
- Docker or [Finch](https://github.com/runfinch/finch) installed for building container images.
- An Amazon ECR private repository.
- Access to AWS Bedrock AgentCore in your target region.

## Build and Push

1. **Create an ECR repository (if needed):**

   ```bash
   aws ecr create-repository --repository-name mongodb-mcp-server --region us-east-1
   ```

2. **Authenticate, build, and push:**

   ```bash
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

   docker build --platform linux/arm64 \
     -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mongodb-mcp-server:latest .

   docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mongodb-mcp-server:latest
   ```

   > **Important:** AgentCore runtimes only support `linux/arm64` images. Always build with `--platform linux/arm64`.

## AgentCore Runtime Configuration

When creating or updating your AgentCore MCP runtime, point the container image URI to your ECR image.

The Dockerfile is pre-configured for AgentCore compatibility:

| Setting | Value | Purpose |
|---|---|---|
| `MDB_MCP_EXTERNALLY_MANAGED_SESSIONS` | `true` | Lets AgentCore manage MCP session IDs |
| `MDB_MCP_HTTP_RESPONSE_TYPE` | `json` | Returns JSON instead of SSE |
| `MDB_MCP_DISABLED_TOOLS` | `atlas-local` | Disables tools unavailable in containers |
| Port | `8000` | HTTP listener port |

### Passing MongoDB Credentials

Set these environment variables in your AgentCore runtime configuration:

- `MDB_MCP_CONNECTION_STRING` — MongoDB connection string
- `MDB_MCP_API_CLIENT_ID` / `MDB_MCP_API_CLIENT_SECRET` — Atlas API credentials (if Atlas tools are enabled)

See the [main README](../../README.md#configuration-options) for all available options.

## Invoking the Runtime

Once deployed, invoke the AgentCore runtime using the Bedrock AgentCore API:

```bash
AGENT_ARN="arn:aws:bedrock-agentcore:<REGION>:<ACCOUNT_ID>:runtime/<RUNTIME_NAME>"
ENCODED_ARN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AGENT_ARN', safe=''))")

curl -X POST \
  "https://bedrock-agentcore.<REGION>.amazonaws.com/runtimes/${ENCODED_ARN}/invocations?qualifier=DEFAULT" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Monitoring

Check AgentCore runtime logs in CloudWatch:

```bash
aws logs describe-log-groups --region us-east-1 \
  --log-group-name-prefix "/aws/bedrock-agentcore"
```
