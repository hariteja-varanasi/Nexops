# Look up the default VPC and its subnets unless explicit ones were given, so
# `terraform apply -var=key_name=...` works on a fresh account with no other input.

data "aws_vpc" "selected" {
  id      = var.vpc_id != "" ? var.vpc_id : null
  default = var.vpc_id == "" ? true : null
}

data "aws_subnets" "selected" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.selected.id]
  }
}

# Canonical's official Ubuntu 24.04 AMI, resolved at apply time. Pinning an AMI
# ID would break the moment you change region and silently go stale otherwise.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  name = "${var.project_name}-${var.environment}"

  subnet_id = var.subnet_id != "" ? var.subnet_id : data.aws_subnets.selected.ids[0]
}
