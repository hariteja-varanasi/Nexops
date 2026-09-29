resource "aws_instance" "nexops" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = var.key_name
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.nexops.id]

  associate_public_ip_address = true

  # gp3 over gp2: same price, and 3000 IOPS baseline regardless of size.
  # Container image pulls and the kind node filesystems are IOPS-hungry.
  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    iops                  = 3000
    throughput            = 125
    encrypted             = true
    delete_on_termination = true

    tags = {
      Name = "${local.name}-root"
    }
  }

  # IMDSv2 required. The v1 endpoint is reachable from any process on the box,
  # including a compromised container, and hands out instance credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2 # 2, not 1: containers need one extra hop
  }

  # Bootstrap only. It installs prerequisites and clones the repository; it
  # deliberately does NOT run setup.sh, so the first cluster build is something
  # the student watches rather than something that already happened.
  user_data = templatefile("${path.module}/user-data.sh", {
    repo_url = "https://github.com/hariteja-varanasi/Nexops.git"
  })

  # Replaces the instance if the bootstrap script changes.
  user_data_replace_on_change = true

  tags = {
    Name = local.name
  }

  lifecycle {
    ignore_changes = [ami] # a new Ubuntu release should not silently rebuild the box
  }
}

# A stable address, so the URL survives a stop/start. Without this the public
# IP changes every time the instance is stopped and every bookmark breaks.
resource "aws_eip" "nexops" {
  instance = aws_instance.nexops.id
  domain   = "vpc"

  tags = {
    Name = "${local.name}-eip"
  }
}
