# ---------------------------------------------------------------------------
# ECR Repository
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "mcp_server" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "mcp_server" {
  repository = aws_ecr_repository.mcp_server.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Docker build & push (linux/arm64 — required by AgentCore)
# ---------------------------------------------------------------------------
# This null_resource runs on every `terraform apply` when the Dockerfile
# or the image tag changes. It authenticates to ECR, builds the image for
# linux/arm64, and pushes it.

resource "null_resource" "docker_build_push" {
  triggers = {
    # Re-run when the image tag or the Dockerfile content changes.
    image_tag        = var.image_tag
    dockerfile_hash  = filemd5("${var.dockerfile_context_path}/Dockerfile")
    repository_url   = aws_ecr_repository.mcp_server.repository_url
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOF
      set -euo pipefail

      ECR_REGISTRY="${local.account_id}.dkr.ecr.${local.region}.amazonaws.com"
      IMAGE_URI="${local.ecr_image_uri}"

      echo "==> Authenticating with ECR..."
      aws ecr get-login-password --region "${local.region}" --profile "${var.aws_profile}" \
        | docker login --username AWS --password-stdin "$ECR_REGISTRY"

      echo "==> Building image for linux/arm64..."
      docker build \
        --platform linux/arm64 \
        -t "$IMAGE_URI" \
        --push \
        "${var.dockerfile_context_path}"

      echo "==> Image pushed: $IMAGE_URI"
    EOF
  }

  depends_on = [aws_ecr_repository.mcp_server]
}
