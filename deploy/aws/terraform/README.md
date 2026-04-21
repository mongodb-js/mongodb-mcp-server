# MongoDB MCP Server — Terraform Deployment for AWS Bedrock AgentCore

This directory contains a fully self-contained Terraform module that:

1. Creates an ECR repository and builds + pushes the `linux/arm64` Docker image.
2. Provisions the IAM execution role, Cognito user pool, and app client.
3. Deploys the MongoDB MCP Server as an AWS Bedrock AgentCore MCP runtime.
4. Provides a Python helper script to generate OAuth2 tokens for testing.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [File structure](#file-structure)
- [Variables reference](#variables-reference)
- [Deployment walkthrough](#deployment-walkthrough)
  - [1 — Clone and configure](#1--clone-and-configure)
  - [2 — Initialize Terraform](#2--initialize-terraform)
  - [3 — Plan and apply](#3--plan-and-apply)
  - [4 — Inspect outputs](#4--inspect-outputs)
- [Generating OAuth tokens](#generating-oauth-tokens)
  - [First login (temporary → permanent password)](#first-login-temporary--permanent-password)
  - [Subsequent logins](#subsequent-logins)
  - [Output formats](#output-formats)
  - [Smoke-testing against the live runtime](#smoke-testing-against-the-live-runtime)
- [Invoking the AgentCore runtime](#invoking-the-agentcore-runtime)
- [Updating the deployment](#updating-the-deployment)
  - [Rebuilding and pushing a new image](#rebuilding-and-pushing-a-new-image)
  - [Rotating MongoDB credentials](#rotating-mongodb-credentials)
- [Destroying the stack](#destroying-the-stack)
- [Troubleshooting](#troubleshooting)
- [Security notes for production](#security-notes-for-production)

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                      Your AWS Account                   │
│                                                         │
│  ┌─────────┐   push    ┌──────────────────────────────┐ │
│  │  Docker │ ────────► │  Amazon ECR                  │ │
│  │  Build  │           │  mongodb-mcp-server:latest   │ │
│  └─────────┘           └──────────────┬───────────────┘ │
│                                       │ pull             │
│  ┌──────────────────┐                 ▼                  │
│  │  Amazon Cognito  │   OIDC   ┌─────────────────────┐  │
│  │  User Pool       │ ◄──────► │  Bedrock AgentCore  │  │
│  │  (OAuth2/OIDC)   │          │  MCP Runtime        │  │
│  └──────────────────┘          │  (port 8000 / HTTP) │  │
│                                └─────────────────────┘  │
│                                        ▲                 │
│                               IAM Execution Role         │
└─────────────────────────────────────────────────────────┘
```

| Component           | Terraform file | AWS resource                              |
| ------------------- | -------------- | ----------------------------------------- |
| Container registry  | `ecr.tf`       | `aws_ecr_repository`                      |
| Docker build + push | `ecr.tf`       | `null_resource` (local-exec)              |
| Execution role      | `iam.tf`       | `aws_iam_role` + policies                 |
| Authentication      | `cognito.tf`   | `aws_cognito_user_pool` + domain + client |
| Test user           | `cognito.tf`   | `aws_cognito_user`                        |
| MCP runtime         | `agentcore.tf` | AWS CLI via `null_resource`               |

---

## Prerequisites

| Tool      | Minimum version | Notes                   |
| --------- | --------------- | ----------------------- |
| Terraform | 1.6.0           | `terraform version`     |
| AWS CLI   | v2              | `aws --version`         |
| Docker    | 24+ with Buildx | `docker buildx version` |
| Python    | 3.9+            | Only for `get_token.py` |
| boto3     | any             | `pip install boto3`     |

**AWS permissions required** (for the identity running `terraform apply`):

- `ecr:*` on the target repository
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PutRolePolicy`
- `cognito-idp:*`
- `bedrock-agentcore:CreateAgentRuntime`, `bedrock-agentcore:UpdateAgentRuntime`, `bedrock-agentcore:ListAgentRuntimes`

Ensure your AWS CLI is configured:

```bash
aws configure
# or
export AWS_PROFILE=my-profile
export AWS_REGION=us-east-1
```

---

## File structure

```
deploy/aws/terraform/
├── main.tf            # Provider config, caller identity, shared locals
├── variables.tf       # All input variables with defaults and descriptions
├── ecr.tf             # ECR repository + Docker build/push null_resource
├── iam.tf             # AgentCore execution role + ECR/CloudWatch policies
├── cognito.tf         # Cognito user pool, domain, app client, test user
├── agentcore.tf       # AgentCore MCP runtime (AWS CLI provisioner)
├── outputs.tf         # All useful post-deployment values
└── scripts/
    └── get_token.py   # Python helper to obtain Cognito OAuth2 tokens
```

---

## Variables reference

| Variable                     | Required | Default                   | Description                                     |
| ---------------------------- | -------- | ------------------------- | ----------------------------------------------- |
| `aws_region`                 | No       | `us-east-1`               | AWS region for all resources                    |
| `ecr_repository_name`        | No       | `mongodb-mcp-server`      | Name of the ECR repository                      |
| `image_tag`                  | No       | `latest`                  | Docker image tag                                |
| `agentcore_runtime_name`     | No       | `mongodb-mcp-server`      | AgentCore runtime name                          |
| `cognito_user_pool_name`     | No       | `mongodb-mcp-server-pool` | Cognito user pool name                          |
| `cognito_test_username`      | No       | `mcp-test-user`           | Test user's Cognito username                    |
| `cognito_test_user_email`    | **Yes**  | —                         | Test user's email address                       |
| `cognito_test_user_password` | **Yes**  | —                         | Temporary password (first login only)           |
| `mdb_connection_string`      | No       | `""`                      | MongoDB connection string (`mongodb://` format) |
| `mdb_api_client_id`          | No       | `""`                      | MongoDB Atlas API client ID                     |
| `mdb_api_client_secret`      | No       | `""`                      | MongoDB Atlas API client secret                 |
| `dockerfile_context_path`    | No       | `..`                      | Path to the directory containing `Dockerfile`   |
| `tags`                       | No       | `{Project, ManagedBy}`    | Tags applied to all AWS resources               |

> **Note on `mdb_connection_string`:** AgentCore does not support `mongodb+srv://` URIs
> (no DNS SRV resolution in the managed runtime network). Use the standard `mongodb://` format
> with a direct host and port, or a load-balanced endpoint.

---

## Deployment walkthrough

### 1 — Clone and configure

```bash
cd deploy/aws/terraform
```

Create a `terraform.tfvars` file (never commit this — add it to `.gitignore`):

```hcl
# terraform.tfvars
aws_region              = "us-east-1"
cognito_test_user_email    = "you@example.com"
cognito_test_user_password = "TempP@ss1234!"   # must satisfy Cognito policy (12+ chars, upper, lower, number, symbol)
mdb_connection_string      = "mongodb://user:pass@your-cluster-host:27017/dbname"
```

Optional — add Atlas API credentials only if you enable Atlas tools:

```hcl
mdb_api_client_id     = "your-atlas-client-id"
mdb_api_client_secret = "your-atlas-client-secret"
```

Alternatively, export sensitive values as environment variables so they never touch disk:

```bash
export TF_VAR_mdb_connection_string="mongodb://user:pass@host:27017/db"
export TF_VAR_cognito_test_user_password="TempP@ss1234!"
export TF_VAR_cognito_test_user_email="you@example.com"
```

### 2 — Initialize Terraform

```bash
terraform init
```

This downloads the `hashicorp/aws` and `hashicorp/null` providers. Expected output:

```
Terraform has been successfully initialized!
```

### 3 — Plan and apply

Preview what will be created (no changes made):

```bash
terraform plan -var-file=terraform.tfvars
```

Apply all changes. Terraform will:

1. Create the ECR repository.
2. Build the Docker image for `linux/arm64` and push it to ECR.
3. Create IAM roles and policies.
4. Create the Cognito user pool, domain, app client, and test user.
5. Create the Bedrock AgentCore MCP runtime via the AWS CLI.

```bash
terraform apply -var-file=terraform.tfvars
```

Type `yes` when prompted. The first apply takes approximately **5–10 minutes** — most of that time is the Docker `buildx` cross-compilation step.

### 4 — Inspect outputs

```bash
terraform output
```

Example output:

```
agentcore_execution_role_arn = "arn:aws:iam::123456789012:role/mongodb-mcp-server-execution-role"
agentcore_runtime_arn        = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/mongodb-mcp-server"
agentcore_runtime_id         = "mongodb-mcp-server"
cognito_token_endpoint       = "https://mongodb-mcp-server-pool-123456789012.auth.us-east-1.amazoncognito.com/oauth2/token"
cognito_user_pool_client_id  = "4abc123def456ghi789"
cognito_user_pool_id         = "us-east-1_AbCdEfGhI"
ecr_image_uri                = "123456789012.dkr.ecr.us-east-1.amazonaws.com/mongodb-mcp-server:latest"
get_token_command            = <<EOT
  python3 scripts/get_token.py \
    --region us-east-1 \
    --user-pool-id us-east-1_AbCdEfGhI \
    --client-id 4abc123def456ghi789 \
    --username mcp-test-user \
    --password <PASSWORD>
EOT
```

---

## Generating OAuth tokens

Cognito tokens are required to call the AgentCore runtime API. The `get_token.py` script handles authentication, including the mandatory password-change challenge that Cognito triggers on first sign-in.

### First login (temporary → permanent password)

When a Cognito user is created via Terraform, AWS sets their status to `FORCE_CHANGE_PASSWORD`. On the very first sign-in you must supply a new permanent password:

```bash
python3 scripts/get_token.py \
  --region us-east-1 \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --client-id $(terraform output -raw cognito_user_pool_client_id) \
  --username mcp-test-user \
  --password "TempP@ss1234!" \
  --new-password "MyPermanentP@ss99!" \
  --verbose
```

`--verbose` prints decoded token claims (subject, email, expiry) to stderr alongside the JSON output.

### Subsequent logins

Once the permanent password is set, omit `--new-password`:

```bash
python3 scripts/get_token.py \
  --region us-east-1 \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --client-id $(terraform output -raw cognito_user_pool_client_id) \
  --username mcp-test-user \
  --password "MyPermanentP@ss99!"
```

You can also supply credentials via environment variables:

```bash
export AWS_REGION=us-east-1
export COGNITO_USER_POOL_ID=$(terraform output -raw cognito_user_pool_id)
export COGNITO_CLIENT_ID=$(terraform output -raw cognito_user_pool_client_id)
export COGNITO_USERNAME=mcp-test-user
export COGNITO_PASSWORD="MyPermanentP@ss99!"

python3 scripts/get_token.py
```

### Output formats

| Flag                      | Output                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `--output json` (default) | Full JSON with `access_token`, `id_token`, `refresh_token`, `expires_in`, `token_type` |
| `--output id_token`       | Just the raw ID token string (for piping into `curl`)                                  |
| `--output access_token`   | Just the raw access token string                                                       |

### Smoke-testing against the live runtime

Pass `--runtime-arn` to automatically call `tools/list` on the deployed AgentCore runtime using the freshly obtained ID token:

```bash
python3 scripts/get_token.py \
  --username mcp-test-user \
  --password "MyPermanentP@ss99!" \
  --runtime-arn $(terraform output -raw agentcore_runtime_arn) \
  --output id_token
```

---

## Invoking the AgentCore runtime

Once you have a token, call the runtime directly using `curl`:

```bash
RUNTIME_ARN=$(terraform output -raw agentcore_runtime_arn)
REGION=$(terraform output -raw cognito_token_endpoint | cut -d. -f3)  # extracts region
ENCODED_ARN=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$RUNTIME_ARN")

TOKEN=$(python3 scripts/get_token.py \
  --username mcp-test-user \
  --password "MyPermanentP@ss99!" \
  --output id_token)

# List available MCP tools
curl -s -X POST \
  "https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${ENCODED_ARN}/invocations?qualifier=DEFAULT" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .
```

---

## Updating the deployment

### Rebuilding and pushing a new image

Bump the image tag in `terraform.tfvars` (or leave it as `latest`). Terraform detects the `Dockerfile` MD5 change and triggers a rebuild automatically:

```bash
terraform apply -var-file=terraform.tfvars -var="image_tag=v1.2.0"
```

### Rotating MongoDB credentials

Update the relevant variable, then re-apply. Only the AgentCore runtime's environment variables are updated — no downtime to ECR or Cognito:

```bash
terraform apply \
  -var-file=terraform.tfvars \
  -var='mdb_connection_string=mongodb://newuser:newpass@host:27017/db'
```

---

## Destroying the stack

```bash
terraform destroy -var-file=terraform.tfvars
```

> **Note:** The Cognito user pool domain must be deleted before the user pool itself.
> Terraform handles this automatically via `depends_on`, but if a partial destroy fails,
> delete the domain manually in the AWS console first, then re-run `terraform destroy`.

---

## Troubleshooting

### Docker build fails: `exec format error` or `no matching manifest`

The AgentCore runtime requires `linux/arm64` images. Ensure Docker Buildx is configured with a multi-platform builder:

```bash
docker buildx create --name multi --use
docker buildx inspect --bootstrap
```

Then re-run `terraform apply`.

---

### ECR authentication fails: `no basic auth credentials`

The AWS CLI identity used by Terraform must have `ecr:GetAuthorizationToken` permission. Verify:

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(terraform output -raw ecr_repository_url | cut -d/ -f1)
```

---

### `terraform apply` hangs at the Docker build step

Cross-compilation for `arm64` on an `x86_64` host requires QEMU emulation and can be slow (10–20 minutes for a cold build). To confirm progress:

```bash
docker buildx build --platform linux/arm64 --progress=plain ..
```

---

### AgentCore runtime creation fails: `ResourceNotFoundException`

Bedrock AgentCore is not available in all regions. Verify availability:

```bash
aws bedrock-agentcore list-agent-runtimes --region us-east-1
```

Supported regions as of early 2025: `us-east-1`, `us-west-2`, `eu-west-1`. Check the [AWS documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) for the current list.

---

### AgentCore runtime creation fails: `AccessDeniedException`

The IAM identity running Terraform must have `bedrock-agentcore:CreateAgentRuntime`. If using an IAM role or SSO session, ensure the session has not expired:

```bash
aws sts get-caller-identity
```

---

### Cognito: `NotAuthorizedException: Incorrect username or password`

- The test user's status may still be `FORCE_CHANGE_PASSWORD`. Re-run `get_token.py` with `--new-password` to complete the challenge.
- Check user status in the AWS console: **Cognito → User pools → Users**.

---

### Cognito: `NEW_PASSWORD_REQUIRED` error in `get_token.py`

You have not yet set a permanent password. Add `--new-password`:

```bash
python3 scripts/get_token.py \
  --username mcp-test-user \
  --password "TempP@ss1234!" \
  --new-password "MyPermanentP@ss99!"
```

The new password must satisfy the Cognito policy (12+ characters, uppercase, lowercase, number, symbol).

---

### Cognito domain conflict: `Domain already exists`

The Cognito domain name (`<pool-name>-<account-id>`) must be globally unique within Cognito. If a previous deploy left a stale domain:

```bash
aws cognito-idp delete-user-pool-domain \
  --domain <your-domain-prefix> \
  --user-pool-id <pool-id> \
  --region us-east-1
```

Then re-run `terraform apply`.

---

### `terraform output` returns `"pending"` for `agentcore_runtime_arn`

The `data.external` lookup runs immediately after `null_resource.agentcore_runtime`. If the AgentCore runtime is still initializing, the ARN may not yet be visible via `list-agent-runtimes`. Wait 30 seconds and run:

```bash
terraform refresh -var-file=terraform.tfvars
terraform output agentcore_runtime_arn
```

---

### MCP server is unreachable / returns 5xx

Check the runtime logs in CloudWatch:

```bash
aws logs describe-log-groups \
  --region us-east-1 \
  --log-group-name-prefix "/aws/bedrock-agentcore"

aws logs tail /aws/bedrock-agentcore/mongodb-mcp-server --follow
```

Common causes:

- Invalid `MDB_MCP_CONNECTION_STRING` — the server will fail to connect to MongoDB on startup.
- `mongodb+srv://` URI used — not supported; use `mongodb://` with a direct host.
- Container OOM — increase memory in the AgentCore runtime configuration if needed.

---

### `boto3` not found when running `get_token.py`

```bash
pip install boto3
# or, in a virtual environment:
python3 -m venv .venv && source .venv/bin/activate && pip install boto3
```

---

## Security notes for production

- **Secrets in state:** `mdb_connection_string`, `mdb_api_client_secret`, and `cognito_test_user_password` are marked `sensitive = true` but are still stored in the Terraform state file. Use a remote backend with encryption (e.g. S3 + KMS) and restrict access to state.
- **Test user:** The `aws_cognito_user` resource is intended for developer testing only. Remove it (and `cognito_test_username` / `cognito_test_user_password`) before deploying to production.
- **MFA:** Cognito MFA is disabled by default. Enable it for production user pools by setting `mfa_configuration = "ON"` in `cognito.tf`.
- **Token lifetime:** Access and ID tokens are valid for 60 minutes. Reduce this for production workloads.
- **Advanced Security:** `advanced_security_mode = "ENFORCED"` is already enabled, providing anomaly detection. Review CloudWatch Cognito logs for suspicious activity.
- **Network mode:** The AgentCore runtime is deployed in `PUBLIC` network mode. For private deployments, change `networkMode` to `VPC` and supply a VPC configuration.
