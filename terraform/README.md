# Terraform

Creates the single EC2 instance everything else runs on: the kind cluster,
Jenkins, SonarQube, Argo CD, Prometheus, Grafana and Loki.

## What gets created

| Resource | Notes |
|---|---|
| `aws_instance` | Ubuntu 24.04, t3.xlarge by default, IMDSv2 required |
| `aws_eip` | Stable address, so the URL survives a stop/start |
| `aws_security_group` | Port 80/443 open; SSH and admin ports limited to your CIDR |
| `root_block_device` | 100 GiB gp3, encrypted |

## Before you start

```bash
aws configure                                   # or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
aws ec2 create-key-pair --key-name nexops-key \
  --query 'KeyMaterial' --output text > nexops-key.pem
chmod 400 nexops-key.pem
```

## Apply

```bash
cd terraform
terraform init
terraform plan  -var="key_name=nexops-key" -var="allowed_ssh_cidr=$(curl -s ifconfig.me)/32"
terraform apply -var="key_name=nexops-key" -var="allowed_ssh_cidr=$(curl -s ifconfig.me)/32"
terraform output next_steps
```

## Cost

A `t3.xlarge` with a 100 GiB gp3 volume is roughly **$0.19/hour**, about
**$140/month** if left running. This is a training box — destroy it when you
are done for the day:

```bash
terraform destroy -var="key_name=nexops-key" -var="allowed_ssh_cidr=$(curl -s ifconfig.me)/32"
```

Stopping the instance instead of destroying it keeps the EBS volume (~$8/month)
and the Elastic IP, and the cluster comes back with `docker start` on the kind
node containers.

## Credentials

None are in this directory and none should be. Terraform reads them from the
environment, `~/.aws/credentials`, or an instance profile. `terraform.tfvars`
and `*.pem` are both git-ignored.
