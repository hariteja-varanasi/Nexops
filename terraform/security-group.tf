resource "aws_security_group" "nexops" {
  name        = "${local.name}-sg"
  description = "NexOps training box: application open, admin tools restricted"
  vpc_id      = data.aws_vpc.selected.id

  tags = {
    Name = "${local.name}-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------- public
# Only the application itself is reachable from anywhere. Everything the
# ingress serves goes through here.

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.nexops.id
  description       = "NexOps application via the NGINX ingress"
  cidr_ipv4         = var.allowed_http_cidr
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.nexops.id
  description       = "NexOps application over TLS, once a certificate is configured"
  cidr_ipv4         = var.allowed_http_cidr
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# ------------------------------------------------------------ restricted
# SSH and every admin UI are limited to allowed_ssh_cidr. Jenkins in
# particular runs arbitrary code by design — exposing it publicly hands the
# box to whoever finds it.

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.nexops.id
  description       = "SSH"
  cidr_ipv4         = var.allowed_ssh_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

locals {
  admin_ports = {
    jenkins    = { port = 8080, note = "Jenkins UI" }
    sonarqube  = { port = 9000, note = "SonarQube UI" }
    argocd     = { port = 8081, note = "Argo CD UI, via port-forward" }
    grafana    = { port = 3000, note = "Grafana, via port-forward" }
    prometheus = { port = 9090, note = "Prometheus, via port-forward" }
    kubeapi    = { port = 6443, note = "Kubernetes API server" }
  }
}

resource "aws_vpc_security_group_ingress_rule" "admin" {
  for_each = local.admin_ports

  security_group_id = aws_security_group.nexops.id
  description       = each.value.note
  cidr_ipv4         = var.allowed_ssh_cidr
  from_port         = each.value.port
  to_port           = each.value.port
  ip_protocol       = "tcp"
}

# ---------------------------------------------------------------- egress
# Outbound must stay open: the box pulls container images, Helm charts,
# apt packages and Trivy's vulnerability database.

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.nexops.id
  description       = "Image pulls, package installs, Trivy DB updates"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
