#!/usr/bin/env bash
# =====================================================================
# Installs every tool the NexOps platform needs on a fresh Ubuntu 24.04 box.
#
#   ./scripts/setup-ec2.sh
#   newgrp docker          <- or log out and back in
#
# Idempotent: anything already present at the right version is skipped.
# =====================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KUBECTL_VERSION="v1.29.2"
KIND_VERSION="v0.23.0"
HELM_VERSION="v3.15.4"
ARGOCD_VERSION="v2.12.4"

[[ $EUID -eq 0 ]] && warn "running as root; the docker group step will be skipped"

ARCH="$(dpkg --print-architecture)"   # amd64 or arm64
[[ "${ARCH}" == "amd64" || "${ARCH}" == "arm64" ]] || die "unsupported architecture: ${ARCH}"

step "System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl wget git jq unzip make gnupg ca-certificates lsb-release apt-transport-https
ok "base packages installed"

# --------------------------------------------------------------- Docker
step "Docker"
if have docker; then
  ok "already installed: $(docker --version)"
else
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  ok "installed: $(docker --version)"
fi

# Running docker without sudo. This takes effect on the NEXT login, which is
# the single most common point of confusion on a fresh box.
if [[ $EUID -ne 0 ]] && ! groups | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  warn "added ${USER} to the docker group — run 'newgrp docker' or log out and back in"
fi

# -------------------------------------------------------------- kubectl
step "kubectl"
if have kubectl && kubectl version --client 2>/dev/null | grep -q "${KUBECTL_VERSION}"; then
  ok "already installed: ${KUBECTL_VERSION}"
else
  curl -fsSLo /tmp/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
  # Verify the checksum. Downloading a binary over HTTPS and running it as root
  # without checking it is exactly how supply-chain compromises land.
  curl -fsSLo /tmp/kubectl.sha256 "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl.sha256"
  echo "$(cat /tmp/kubectl.sha256)  /tmp/kubectl" | sha256sum --check --status \
    || die "kubectl checksum mismatch — do not run this binary"
  sudo install -o root -g root -m 0755 /tmp/kubectl /usr/local/bin/kubectl
  rm -f /tmp/kubectl /tmp/kubectl.sha256
  ok "installed: $(kubectl version --client -o json | jq -r .clientVersion.gitVersion)"
fi

# ----------------------------------------------------------------- kind
step "kind"
if have kind && kind version 2>/dev/null | grep -q "${KIND_VERSION#v}"; then
  ok "already installed: $(kind version)"
else
  curl -fsSLo /tmp/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-${ARCH}"
  sudo install -o root -g root -m 0755 /tmp/kind /usr/local/bin/kind
  rm -f /tmp/kind
  ok "installed: $(kind version)"
fi

# ----------------------------------------------------------------- Helm
step "Helm"
if have helm && helm version --short 2>/dev/null | grep -q "${HELM_VERSION}"; then
  ok "already installed: $(helm version --short)"
else
  curl -fsSLo /tmp/helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-${ARCH}.tar.gz"
  curl -fsSLo /tmp/helm.sha256 "https://get.helm.sh/helm-${HELM_VERSION}-linux-${ARCH}.tar.gz.sha256sum"
  awk '{print $1"  /tmp/helm.tar.gz"}' /tmp/helm.sha256 | sha256sum --check --status \
    || die "helm checksum mismatch — do not install this archive"
  tar -xzf /tmp/helm.tar.gz -C /tmp
  sudo install -o root -g root -m 0755 "/tmp/linux-${ARCH}/helm" /usr/local/bin/helm
  rm -rf /tmp/helm.tar.gz /tmp/helm.sha256 "/tmp/linux-${ARCH}"
  ok "installed: $(helm version --short)"
fi

# ------------------------------------------------------------- AWS CLI
step "AWS CLI"
if have aws; then
  ok "already installed: $(aws --version 2>&1)"
else
  AWS_ARCH=$([[ "${ARCH}" == "arm64" ]] && echo aarch64 || echo x86_64)
  curl -fsSLo /tmp/awscliv2.zip "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip"
  unzip -q /tmp/awscliv2.zip -d /tmp
  sudo /tmp/aws/install --update
  rm -rf /tmp/awscliv2.zip /tmp/aws
  ok "installed: $(aws --version 2>&1)"
fi

# --------------------------------------------------------------- Trivy
step "Trivy"
if have trivy; then
  ok "already installed: $(trivy --version | head -1)"
else
  # The pipeline runs Trivy as a container, so this is for running scans by
  # hand. Both read the same vulnerability database.
  curl -fsSL https://aquasecurity.github.io/trivy-repo/deb/public.key \
    | sudo gpg --dearmor -o /usr/share/keyrings/trivy.gpg
  echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] \
https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" \
    | sudo tee /etc/apt/sources.list.d/trivy.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq trivy
  ok "installed: $(trivy --version | head -1)"
fi

# ---------------------------------------------------------- Argo CD CLI
step "Argo CD CLI"
if have argocd; then
  ok "already installed: $(argocd version --client --short 2>/dev/null || echo present)"
else
  curl -fsSLo /tmp/argocd "https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_VERSION}/argocd-linux-${ARCH}"
  sudo install -o root -g root -m 0755 /tmp/argocd /usr/local/bin/argocd
  rm -f /tmp/argocd
  ok "installed: $(argocd version --client --short 2>/dev/null || echo argocd)"
fi

# -------------------------------------------------------------- Node.js
step "Node.js"
if have node && [[ "$(node -v | cut -d. -f1 | tr -d v)" -ge 20 ]]; then
  ok "already installed: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
  ok "installed: $(node -v), npm $(npm -v)"
fi

# --------------------------------------------------------- kernel tuning
step "Kernel settings"
# SonarQube's Elasticsearch will not start below this.
if [[ "$(sysctl -n vm.max_map_count)" -lt 262144 ]]; then
  sudo sysctl -w vm.max_map_count=262144
  echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf >/dev/null
  ok "vm.max_map_count raised to 262144"
else
  ok "vm.max_map_count already sufficient"
fi
# kind runs many containers, each watching files.
if [[ "$(sysctl -n fs.inotify.max_user_instances)" -lt 512 ]]; then
  sudo sysctl -w fs.inotify.max_user_instances=512
  sudo sysctl -w fs.inotify.max_user_watches=524288
  printf 'fs.inotify.max_user_instances=512\nfs.inotify.max_user_watches=524288\n' \
    | sudo tee -a /etc/sysctl.conf >/dev/null
  ok "inotify limits raised (kind needs these)"
fi

# ------------------------------------------------------------ verification
step "Verification"
FAILED=0
check() {
  if out=$("${@:2}" 2>&1 | head -1); then
    printf '    %s✓%s %-12s %s\n' "$G" "$N" "$1" "${out}"
  else
    printf '    %s✗%s %-12s not working\n' "$R" "$N" "$1"
    FAILED=1
  fi
}
check docker   docker --version
check kubectl  kubectl version --client -o yaml
check kind     kind version
check helm     helm version --short
check aws      aws --version
check trivy    trivy --version
check argocd   argocd version --client --short
check node     node --version
check git      git --version

echo
if [[ $FAILED -ne 0 ]]; then
  die "some tools did not verify; scroll up for the failures"
fi

if ! docker info >/dev/null 2>&1; then
  cat <<'DOCKERNOTE'

    Docker is installed but this shell cannot talk to it yet, because the
    group membership only applies to new logins. Fix it now with:

        newgrp docker

    then re-run: docker info

DOCKERNOTE
  exit 0
fi

cat <<'DONE'

    All tools verified. Next:

        ./setup.sh

    That builds the images, creates the kind cluster and deploys NexOps.

DONE
