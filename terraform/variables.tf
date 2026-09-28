variable "aws_region" {
  description = "Region to create the training instance in"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Tag applied to every resource"
  type        = string
  default     = "training"
}

variable "project_name" {
  description = "Name prefix for every resource"
  type        = string
  default     = "nexops"
}

variable "instance_type" {
  description = <<-EOT
    EC2 instance type. The whole stack — kind with three nodes, Jenkins,
    SonarQube, Prometheus, Grafana, Loki and Argo CD — needs real memory.

      t3.large   (2 vCPU,  8 GiB)  works, but SonarQube and Prometheus will be tight
      t3.xlarge  (4 vCPU, 16 GiB)  recommended
      t3.2xlarge (8 vCPU, 32 GiB)  comfortable

    SonarQube alone wants ~2 GiB and will be OOM-killed on anything smaller
    than t3.large.
  EOT
  type        = string
  default     = "t3.xlarge"

  validation {
    condition     = can(regex("^(t3|t3a|m5|m6i|c5)\\.(large|xlarge|2xlarge)$", var.instance_type))
    error_message = "Use at least a *.large instance; smaller types cannot run this stack."
  }
}

variable "root_volume_size" {
  description = "Root disk in GiB. Docker images, kind nodes and Prometheus/Loki volumes all live here."
  type        = number
  default     = 100

  validation {
    condition     = var.root_volume_size >= 50
    error_message = "50 GiB is the practical floor; the container images alone are ~15 GiB."
  }
}

variable "key_name" {
  description = "Name of an existing EC2 key pair for SSH. Create one first: aws ec2 create-key-pair --key-name nexops-key"
  type        = string
}

variable "allowed_ssh_cidr" {
  description = <<-EOT
    CIDR permitted to reach SSH and the admin tool ports.

    Defaults to a value that will fail validation on purpose, so nobody opens
    port 22 to the internet by accident. Set it to your own address:

      terraform apply -var="allowed_ssh_cidr=$(curl -s ifconfig.me)/32"
  EOT
  type        = string
  default     = "0.0.0.0/0"

  validation {
    condition     = var.allowed_ssh_cidr != "0.0.0.0/0"
    error_message = "Refusing to open admin ports to the whole internet. Pass your own CIDR, e.g. -var=\"allowed_ssh_cidr=1.2.3.4/32\"."
  }
}

variable "allowed_http_cidr" {
  description = "CIDR permitted to reach the NexOps application on port 80. Open by default, since the app is the thing being demonstrated."
  type        = string
  default     = "0.0.0.0/0"
}

variable "vpc_id" {
  description = "VPC to launch into. Empty uses the account's default VPC."
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Subnet to launch into. Empty picks the first subnet in the VPC."
  type        = string
  default     = ""
}
