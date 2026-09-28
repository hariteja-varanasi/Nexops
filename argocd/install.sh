#!/usr/bin/env bash
# Installs Argo CD into the kind cluster and registers the three NexOps apps.
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib.sh"

need kubectl

step "Installing Argo CD"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.12.4/manifests/install.yaml

info "waiting for the Argo CD server (this pulls several images, give it a few minutes)"
kubectl -n argocd rollout status deployment/argocd-server --timeout=300s
kubectl -n argocd rollout status deployment/argocd-repo-server --timeout=300s
ok "Argo CD is running"

step "Registering NexOps Applications"
kubectl apply -f "${REPO_ROOT}/argocd/applications.yaml"
kubectl -n argocd get applications

step "Access"
ADMIN_PW=$(kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || echo '<already rotated>')

cat <<SUMMARY

  UI        kubectl -n argocd port-forward svc/argocd-server 8081:443
            https://localhost:8081   (self-signed certificate, accept the warning)

  Username  admin
  Password  ${ADMIN_PW}

  Rotate that password now, then delete the bootstrap secret:
    argocd login localhost:8081 --username admin --password '${ADMIN_PW}' --insecure
    argocd account update-password
    kubectl -n argocd delete secret argocd-initial-admin-secret

  Applications registered:
    nexops-dev         auto-sync, self-heal, prune
    nexops-staging     auto-sync, self-heal
    nexops-prod        MANUAL sync — someone must approve it

SUMMARY
