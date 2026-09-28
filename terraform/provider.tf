terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Local state by default so this works with no prior setup. For anything
  # shared, move it to S3 with DynamoDB locking — local state means two people
  # applying at once silently corrupt each other's view of the world.
  #
  # backend "s3" {
  #   bucket         = "your-tf-state-bucket"
  #   key            = "nexops/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  # No credentials here on purpose. Terraform reads them, in order, from:
  #   1. the AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY environment variables
  #   2. ~/.aws/credentials  (aws configure)
  #   3. the EC2 instance profile, if running on AWS
  # Hardcoding a key here is how they end up on GitHub.

  default_tags {
    tags = {
      Project     = "NexOps"
      ManagedBy   = "Terraform"
      Environment = var.environment
    }
  }
}
