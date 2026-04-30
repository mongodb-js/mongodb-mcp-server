# ---------------------------------------------------------------------------
# IAM – Execution role for the AgentCore MCP runtime
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "agentcore_trust" {
  statement {
    sid     = "AgentCoreTrust"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "agentcore_execution" {
  name               = "${var.agentcore_runtime_name}-execution-role"
  assume_role_policy = data.aws_iam_policy_document.agentcore_trust.json
  description        = "Execution role for the ${var.agentcore_runtime_name} AgentCore MCP runtime"
}

# Allow the runtime to pull from ECR
data "aws_iam_policy_document" "agentcore_ecr" {
  statement {
    sid    = "ECRGetAuthToken"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ECRPullImage"
    effect = "Allow"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
    resources = [aws_ecr_repository.mcp_server.arn]
  }
}

resource "aws_iam_policy" "agentcore_ecr" {
  name        = "${var.agentcore_runtime_name}-ecr-pull"
  description = "Allow AgentCore execution role to pull from ECR"
  policy      = data.aws_iam_policy_document.agentcore_ecr.json
}

resource "aws_iam_role_policy_attachment" "agentcore_ecr" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = aws_iam_policy.agentcore_ecr.arn
}

# Allow runtime logs to be written to CloudWatch
data "aws_iam_policy_document" "agentcore_logs" {
  statement {
    sid    = "CloudWatchLogsGroup"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
    ]
  }

  statement {
    sid     = "CloudWatchLogsDescribeGroups"
    effect  = "Allow"
    actions = ["logs:DescribeLogGroups"]
    resources = [
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:*",
    ]
  }

  statement {
    sid    = "CloudWatchLogsStream"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
    ]
  }
}

resource "aws_iam_policy" "agentcore_logs" {
  name        = "${var.agentcore_runtime_name}-cloudwatch-logs"
  description = "Allow AgentCore runtime to write CloudWatch logs"
  policy      = data.aws_iam_policy_document.agentcore_logs.json
}

resource "aws_iam_role_policy_attachment" "agentcore_logs" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = aws_iam_policy.agentcore_logs.arn
}

# Allow X-Ray tracing
data "aws_iam_policy_document" "agentcore_xray" {
  statement {
    sid    = "XRayTracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "agentcore_xray" {
  name        = "${var.agentcore_runtime_name}-xray"
  description = "Allow AgentCore runtime to send X-Ray traces"
  policy      = data.aws_iam_policy_document.agentcore_xray.json
}

resource "aws_iam_role_policy_attachment" "agentcore_xray" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = aws_iam_policy.agentcore_xray.arn
}

# Allow CloudWatch metrics under the bedrock-agentcore namespace
data "aws_iam_policy_document" "agentcore_metrics" {
  statement {
    sid     = "CloudWatchMetrics"
    effect  = "Allow"
    actions = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["bedrock-agentcore"]
    }
  }
}

resource "aws_iam_policy" "agentcore_metrics" {
  name        = "${var.agentcore_runtime_name}-cloudwatch-metrics"
  description = "Allow AgentCore runtime to publish metrics to CloudWatch"
  policy      = data.aws_iam_policy_document.agentcore_metrics.json
}

resource "aws_iam_role_policy_attachment" "agentcore_metrics" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = aws_iam_policy.agentcore_metrics.arn
}

# Allow AgentCore workload identity access tokens
data "aws_iam_policy_document" "agentcore_workload_identity" {
  statement {
    sid    = "GetAgentAccessToken"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
    ]
    resources = [
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default",
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default/workload-identity/${var.agentcore_runtime_name}-*",
    ]
  }
}

resource "aws_iam_policy" "agentcore_workload_identity" {
  name        = "${var.agentcore_runtime_name}-workload-identity"
  description = "Allow AgentCore runtime to obtain workload access tokens"
  policy      = data.aws_iam_policy_document.agentcore_workload_identity.json
}

resource "aws_iam_role_policy_attachment" "agentcore_workload_identity" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = aws_iam_policy.agentcore_workload_identity.arn
}

# Allow Bedrock model invocation
data "aws_iam_policy_document" "agentcore_bedrock" {
  statement {
    sid    = "BedrockModelInvocation"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:${local.region}:${local.account_id}:*",
    ]
  }
}

resource "aws_iam_policy" "agentcore_bedrock" {
  name        = "${var.agentcore_runtime_name}-bedrock-invoke"
  description = "Allow AgentCore runtime to invoke Bedrock foundation models"
  policy      = data.aws_iam_policy_document.agentcore_bedrock.json
}

resource "aws_iam_role_policy_attachment" "agentcore_bedrock" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = aws_iam_policy.agentcore_bedrock.arn
}
