#!/usr/bin/env bash
# Installs Loki and Promtail. Grafana already has the Loki data source
# provisioned by monitoring/grafana-values.yaml, so logs appear there
# immediately after this finishes.
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib.sh"

need kubectl
need helm

step "Namespace"
kubectl create namespace logging --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace logging kubernetes.io/metadata.name=logging --overwrite >/dev/null

step "Helm repository"
helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
helm repo update >/dev/null

step "Loki"
# Single-binary mode: one pod, filesystem storage. The microservices mode is
# correct for production and pointless on one EC2 box.
helm upgrade --install loki grafana/loki \
  --namespace logging \
  --values "${REPO_ROOT}/logging/loki-values.yaml" \
  --wait --timeout 10m
ok "loki installed"

step "Promtail"
# Promtail is a DaemonSet: one agent per node, tailing every container's stdout
# from /var/log/pods. Applications do not ship their own logs — they write to
# stdout and the platform collects them.
helm upgrade --install promtail grafana/promtail \
  --namespace logging \
  --values "${REPO_ROOT}/logging/promtail-values.yaml" \
  --wait --timeout 5m
ok "promtail installed on every node"

step "Verifying"
kubectl -n logging get pods
info "Promtail pods should equal the node count: $(kubectl get nodes --no-headers | wc -l)"

cat <<'SUMMARY'

  In Grafana, open Explore, choose the Loki data source, and try:

    {namespace="nexops-dev"}                          everything in dev
    {namespace="nexops-dev", app="backend"}           one application
    {namespace="nexops-dev"} | json | level="ERROR"   errors only
    {namespace="nexops-dev"} |= "readinessProbe"      full-text search

  The backend logs one JSON object per line, so `| json` parses the fields and
  you can filter on level, requestId, route or status directly.

  Point NexOps at Loki so its own Logs page queries the cluster:

    helm upgrade nexops ./helm/nexops --reuse-values -n nexops-dev \
      --set config.lokiUrl=http://loki.logging.svc.cluster.local:3100

SUMMARY
