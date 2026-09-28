output "public_ip" {
  description = "Elastic IP of the training instance"
  value       = aws_eip.nexops.public_ip
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.nexops.id
}

output "ssh_command" {
  description = "Copy-paste this to connect"
  value       = "ssh -i ${var.key_name}.pem ubuntu@${aws_eip.nexops.public_ip}"
}

output "nexops_url" {
  description = "Where the application will be once setup.sh has run"
  value       = "http://${aws_eip.nexops.public_ip}"
}

output "admin_tunnels" {
  description = "Admin UIs are not exposed directly; tunnel to them over SSH"
  value = {
    jenkins   = "http://${aws_eip.nexops.public_ip}:8080"
    sonarqube = "http://${aws_eip.nexops.public_ip}:9000"
    argocd    = "ssh -i ${var.key_name}.pem -L 8081:localhost:8081 ubuntu@${aws_eip.nexops.public_ip}  # then kubectl -n argocd port-forward svc/argocd-server 8081:443"
    grafana   = "ssh -i ${var.key_name}.pem -L 3000:localhost:3000 ubuntu@${aws_eip.nexops.public_ip}  # then kubectl -n monitoring port-forward svc/grafana 3000:80"
  }
}

output "next_steps" {
  description = "What to do after apply finishes"
  value       = <<-EOT

    1. Wait ~90 seconds for the bootstrap script to finish.

    2. ssh -i ${var.key_name}.pem ubuntu@${aws_eip.nexops.public_ip}

    3. cd ~/nexops
       ./scripts/setup-ec2.sh
       newgrp docker
       ./setup.sh

    4. Open http://${aws_eip.nexops.public_ip}

    Tear it all down with: terraform destroy

  EOT
}
