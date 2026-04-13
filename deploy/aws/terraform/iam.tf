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
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/*",
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
