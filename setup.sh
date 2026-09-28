#!/usr/bin/env bash
# =====================================================================
# NexOps - one command to a running platform
#
#   ./setup.sh                 application only (fastest, ~6 minutes)
#   ./setup.sh --full          application + Argo CD + monitoring + logging
#   ./setup.sh --with-ci       also start Jenkins and SonarQube
#   ./setup.sh --everything    all of the above
#   ./setup.sh --clean         delete the cluster and start over
#
# Every step is idempotent. If it fails halfway, fix the cause and run it
# again — it will skip what already succeeded.
# =====================================================================
source "$(dirname "${BASH_SOURCE[0]}")/scripts/lib.sh"

WITH_GITOPS=false
WITH_OBSERVABILITY=false
WITH_CI=false
CLEAN=false
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="nexops-${ENVIRONMENT}"
IMAGE_TAG="${IMAGE_TAG:-local}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)       WITH_GITOPS=true; WITH_OBSERVABILITY=true ;;
    --with-ci)    WITH_CI=true ;;
    --everything) WITH_GITOPS=true; WITH_OBSERVABILITY=true; WITH_CI=true ;;
    --clean)      CLEAN=true ;;
    --env)        ENVIRONMENT="$2"; NAMESPACE="nexops-$2"; shift ;;
    -h|--help)    sed -n '3,14p' "$0"; exit 0 ;;
    *)            die "unknown option: $1  (try --help)" ;;
  esac
  shift
done

START_TIME=$(date +%s)

cat <<'BANNER'

    ███╗   ██╗███████╗██╗  ██╗ ██████╗ ██████╗ ███████╗
    ████╗  ██║██╔════╝╚██╗██╔╝██╔═══██╗██╔══██╗██╔════╝
    ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║██████╔╝███████╗
    ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║██╔═══╝ ╚════██║
    ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝██║     ███████║
    ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚══════╝

    End-to-end DevOps platform on a single machine

BANNER

# ---------------------------------------------------------------- 1. deps
step "1/13  Checking prerequisites"
MISSING=()
for tool in docker kind kubectl helm; do
  have "$tool" || MISSING+=("$tool")
done
if (( ${#MISSING[@]} )); then
  die "missing: ${MISSING[*]}
    Run ./scripts/setup-ec2.sh first, then 'newgrp docker'."
fi
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon.
    If you just installed Docker, run: newgrp docker
    Otherwise: sudo systemctl start docker"

# The stack needs real memory. Warn loudly rather than failing three minutes
# in with an unexplained OOMKilled pod.
TOTAL_MEM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1048576}' /proc/meminfo)
FREE_DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
info "memory ${TOTAL_MEM_GB}GiB, free disk ${FREE_DISK_GB}GiB"
(( TOTAL_MEM_GB >= 7 ))  || warn "under 8GiB of RAM; expect pods to be OOM-killed"
(( FREE_DISK_GB >= 25 )) || warn "under 25GiB free; image pulls may fail"
ok "prerequisites satisfied"

# --------------------------------------------------------------- 2. clean
if [[ "$CLEAN" == true ]]; then
  step "Cleaning up"
  FORCE=yes "${REPO_ROOT}/scripts/delete-kind-cluster.sh"
  ok "cluster removed; re-run ./setup.sh to rebuild"
  exit 0
fi

# --------------------------------------------------------------- 3. env
step "2/13  Configuration"
# This repository is public, so a committed secret is a published secret.
# Install the commit-time guard if the working copy is a git clone.
if [[ -d "${REPO_ROOT}/.git" ]] && [[ "$(git -C "${REPO_ROOT}" config --get core.hooksPath || true)" != ".githooks" ]]; then
  git -C "${REPO_ROOT}" config core.hooksPath .githooks && ok "secret-scanning pre-commit hook installed"
fi

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  cp "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
  # Generate real secrets rather than shipping the placeholders forward.
  JWT="$(openssl rand -hex 32)"
  PGPW="$(openssl rand -base64 24 | tr -d '/+=')"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|"                 "${REPO_ROOT}/.env"
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PGPW}|"  "${REPO_ROOT}/.env"
  ok ".env created with generated JWT_SECRET and POSTGRES_PASSWORD"
  warn "the demo login is still admin/admin123 — change SEED_ADMIN_PASSWORD before sharing this box"
else
  ok ".env already exists, leaving it alone"
fi
set -a; source "${REPO_ROOT}/.env"; set +a

# ------------------------------------------------------------- 4. cluster
step "3/13  kind cluster"
"${REPO_ROOT}/scripts/create-kind-cluster.sh"

# -------------------------------------------------------------- 5. build
step "4/13  Building images"
IMAGE_TAG="${IMAGE_TAG}" "${REPO_ROOT}/scripts/build-images.sh"

# --------------------------------------------------------------- 6. load
step "5/13  Loading images into kind"
IMAGE_TAG="${IMAGE_TAG}" "${REPO_ROOT}/scripts/load-images.sh"

# ------------------------------------------------------------ 7. secrets
step "6/13  Namespace and secrets"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# Created imperatively, never from a file in Git. --dry-run | apply makes this
# re-runnable without an "already exists" error.
kubectl -n "${NAMESPACE}" create secret generic nexops-secrets \
  --from-literal=POSTGRES_DB="${POSTGRES_DB}" \
  --from-literal=POSTGRES_USER="${POSTGRES_USER}" \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=SEED_ADMIN_USERNAME="${SEED_ADMIN_USERNAME}" \
  --from-literal=SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD}" \
  --from-literal=DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@nexops-postgres:5432/${POSTGRES_DB}" \
  --dry-run=client -o yaml | kubectl apply -f -
ok "secret nexops-secrets created in ${NAMESPACE}"

# ------------------------------------------------------------- 8. deploy
step "7/13  Deploying NexOps with Helm"
helm upgrade --install nexops "${REPO_ROOT}/helm/nexops" \
  --namespace "${NAMESPACE}" \
  --values "${REPO_ROOT}/helm/nexops/values-${ENVIRONMENT}.yaml" \
  --set image.registry="" \
  --set image.repository="" \
  --set image.tag="${IMAGE_TAG}" \
  --set image.pullPolicy=IfNotPresent \
  --set secrets.createSecret=false \
  --set secrets.existingSecret=nexops-secrets \
  --wait --timeout 10m \
  || {
    warn "helm reported a timeout; showing what is stuck"
    kubectl -n "${NAMESPACE}" get pods
    kubectl -n "${NAMESPACE}" describe pods | grep -A5 "Events:" | tail -30
    die "deployment did not become ready — see the events above"
  }
ok "NexOps deployed to ${NAMESPACE}"

# Empty registry and repository above mean the chart renders the bare image
# name, "nexops-backend:local", which is exactly what kind loaded. With a
# registry prefix the kubelet would ignore the local copy and try to pull.
step "8/13  Confirming the rollout"
kubectl -n "${NAMESPACE}" rollout status deployment/nexops-backend  --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/nexops-frontend --timeout=180s
ok "pods running the loaded images"

# ------------------------------------------------------------- 9. verify
step "9/13  Verifying the deployment"
kubectl -n "${NAMESPACE}" get pods

info "checking the API from inside the cluster"
if kubectl -n "${NAMESPACE}" run nexops-verify --rm -i --restart=Never \
     --image=curlimages/curl:8.10.1 --quiet -- \
     curl -fsS "http://nexops-backend:4000/api/health" 2>/dev/null; then
  echo
  ok "the API reports healthy"
else
  warn "the health check did not pass yet; logs: kubectl -n ${NAMESPACE} logs -l app.kubernetes.io/component=backend"
fi

# -------------------------------------------------------------- 10. hosts
step "10/13  Hostname"
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
INGRESS_HOST="nexops-${ENVIRONMENT}.local"
if ! grep -q "${INGRESS_HOST}" /etc/hosts 2>/dev/null; then
  echo "127.0.0.1 ${INGRESS_HOST}" | sudo tee -a /etc/hosts >/dev/null \
    && ok "added ${INGRESS_HOST} to /etc/hosts" \
    || warn "could not write /etc/hosts; use http://${HOST_IP} instead"
else
  ok "${INGRESS_HOST} already in /etc/hosts"
fi

# ------------------------------------------------------------- 11. argocd
if [[ "$WITH_GITOPS" == true ]]; then
  step "11/13  Argo CD"
  "${REPO_ROOT}/argocd/install.sh"
else
  step "11/13  Argo CD  (skipped — pass --full to install)"
fi

# -------------------------------------------------- 12. observability
if [[ "$WITH_OBSERVABILITY" == true ]]; then
  step "12/13  Prometheus, Grafana and Loki"
  "${REPO_ROOT}/monitoring/install.sh"
  "${REPO_ROOT}/logging/install.sh"

  info "switching NexOps from stored samples to live Prometheus and Loki"
  helm upgrade nexops "${REPO_ROOT}/helm/nexops" \
    --namespace "${NAMESPACE}" --reuse-values \
    --set config.prometheusUrl=http://prometheus-server.monitoring.svc.cluster.local \
    --set config.lokiUrl=http://loki.logging.svc.cluster.local:3100 \
    --wait --timeout 5m
  ok "the Monitoring and Logs pages now query the cluster"
else
  step "12/13  Observability  (skipped — pass --full to install)"
fi

# ------------------------------------------------------------------ 13. ci
if [[ "$WITH_CI" == true ]]; then
  step "13/13  Jenkins and SonarQube"
  if [[ ! -f "${REPO_ROOT}/jenkins/.env" ]]; then
    cp "${REPO_ROOT}/jenkins/.env.example" "${REPO_ROOT}/jenkins/.env"
    sed -i "s|^JENKINS_ADMIN_PASSWORD=.*|JENKINS_ADMIN_PASSWORD=$(openssl rand -base64 18)|" "${REPO_ROOT}/jenkins/.env"
    sed -i "s|^SONAR_DB_PASSWORD=.*|SONAR_DB_PASSWORD=$(openssl rand -base64 18)|"           "${REPO_ROOT}/jenkins/.env"
    ok "jenkins/.env created with generated passwords"
  fi
  (cd "${REPO_ROOT}/jenkins" && docker compose up -d --build)
  ok "Jenkins and SonarQube starting (SonarQube takes ~3 minutes on first boot)"
else
  step "13/13  CI tooling  (skipped — pass --with-ci to start it)"
fi

# ----------------------------------------------------------------- done
ELAPSED=$(( $(date +%s) - START_TIME ))

cat <<SUMMARY

${G}════════════════════════════════════════════════════════════════${N}
  NexOps is up. Took $((ELAPSED / 60))m $((ELAPSED % 60))s.
${G}════════════════════════════════════════════════════════════════${N}

  ${B}Application${N}
    http://${INGRESS_HOST}
    http://${HOST_IP}                      (no hosts entry needed)

    Sign in:  ${SEED_ADMIN_USERNAME}  /  ${SEED_ADMIN_PASSWORD}

  ${B}Cluster${N}
    kubectl -n ${NAMESPACE} get pods
    kubectl -n ${NAMESPACE} logs -l app.kubernetes.io/component=backend -f
    kubectl get nodes -o wide

SUMMARY

if [[ "$WITH_GITOPS" == true ]]; then
cat <<'SUMMARY'
  Argo CD
    kubectl -n argocd port-forward svc/argocd-server 8081:443
    https://localhost:8081   (admin / see the password printed above)

SUMMARY
fi

if [[ "$WITH_OBSERVABILITY" == true ]]; then
cat <<'SUMMARY'
  Grafana
    kubectl -n monitoring port-forward svc/grafana 3000:80
    http://localhost:3000    (dashboards are under the NexOps folder)

  Prometheus
    kubectl -n monitoring port-forward svc/prometheus-server 9090:80
    http://localhost:9090/targets

SUMMARY
fi

if [[ "$WITH_CI" == true ]]; then
cat <<SUMMARY
  Jenkins
    http://${HOST_IP}:8080   (admin / see jenkins/.env)

  SonarQube
    http://${HOST_IP}:9000   (admin / admin on first login, then change it)

SUMMARY
fi

cat <<'SUMMARY'
  Next
    docs/installation.md     what just happened, step by step
    docs/troubleshooting.md  when something is not right
    ./scripts/demo-scaling.sh, demo-failure.sh, demo-rollback.sh

  Tear down
    ./setup.sh --clean

SUMMARY
