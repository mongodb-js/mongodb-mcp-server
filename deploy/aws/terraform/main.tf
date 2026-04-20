terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.50.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  profile = "<PROFILE_NAME>" # Replace with your AWS CLI profile name if needed

  default_tags {
    tags = var.tags
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id    = data.aws_caller_identity.current.account_id
  region        = data.aws_region.current.id
  ecr_image_uri = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com/${var.ecr_repository_name}:${var.image_tag}"
}
