#!/usr/bin/env bash
# Runs once, as root, on first boot. Output goes to /var/log/user-data.log.
set -euxo pipefail
exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1

echo "=== NexOps bootstrap starting ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y git curl jq unzip ca-certificates gnupg make

# SonarQube's embedded Elasticsearch needs this or it refuses to start.
# Set it now and persist it, rather than debugging a crash loop later.
sysctl -w vm.max_map_count=262144
echo "vm.max_map_count=262144" >> /etc/sysctl.conf

# Docker, Prometheus and Loki all keep many files open.
cat >> /etc/security/limits.conf <<'LIMITS'
*  soft  nofile  65536
*  hard  nofile  65536
LIMITS

cd /home/ubuntu
sudo -u ubuntu git clone ${repo_url} nexops || echo "clone skipped"
chown -R ubuntu:ubuntu /home/ubuntu/nexops

cat > /etc/motd <<'MOTD'

  NexOps training instance

  The tools are not installed yet. Run these in order:

    cd ~/nexops
    ./scripts/setup-ec2.sh     installs Docker, kubectl, kind, Helm, Trivy
    newgrp docker              picks up the new docker group without logging out
    ./setup.sh                 builds and deploys the whole platform

  Bootstrap log: /var/log/user-data.log

MOTD

echo "=== NexOps bootstrap complete ==="
