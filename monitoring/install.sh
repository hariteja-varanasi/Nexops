#!/usr/bin/env bash
# Installs Prometheus and Grafana into the kind cluster.
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib.sh"

need kubectl
need helm

step "Namespace"
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
# Labelled so the NetworkPolicy in kubernetes/base/ingress can allow scrapes.
kubectl label namespace monitoring kubernetes.io/metadata.name=monitoring --overwrite >/dev/null

step "Helm repositories"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
helm repo update >/dev/null
ok "repositories updated"

step "Prometheus"
helm upgrade --install prometheus prometheus-community/prometheus \
  --namespace monitoring \
  --values "${REPO_ROOT}/monitoring/prometheus-values.yaml" \
  --wait --timeout 10m
ok "prometheus installed"

step "Grafana"
# Grafana's admin password is generated here and stored only in the cluster
# Secret. It is never written to a file in this repository.
if ! kubectl -n monitoring get secret grafana >/dev/null 2>&1; then
  GRAFANA_PW="$(openssl rand -base64 18)"
else
  GRAFANA_PW="$(kubectl -n monitoring get secret grafana -o jsonpath='{.data.admin-password}' | base64 -d)"
fi

helm upgrade --install grafana grafana/grafana \
  --namespace monitoring \
  --values "${REPO_ROOT}/monitoring/grafana-values.yaml" \
  --set adminPassword="${GRAFANA_PW}" \
  --wait --timeout 10m
ok "grafana installed"

step "Loading NexOps dashboards"
kubectl -n monitoring create configmap nexops-dashboards \
  --from-file="${REPO_ROOT}/monitoring/grafana-dashboards/" \
  --dry-run=client -o yaml | kubectl label -f - --local -o yaml grafana_dashboard=1 \
  | kubectl apply -f -
ok "dashboards loaded (the Grafana sidecar picks them up within ~60s)"

step "Pointing NexOps at Prometheus"
cat <<'HINT'
    The Monitoring page still reads from PostgreSQL until the API knows where
    Prometheus is. Set it and the charts switch to live PromQL:

      helm upgrade nexops ./helm/nexops --reuse-values -n nexops-dev \
        --set config.prometheusUrl=http://prometheus-server.monitoring.svc.cluster.local

    Or, under GitOps, it is already set in gitops/dev/values.yaml.
HINT

cat <<SUMMARY

  Prometheus  kubectl -n monitoring port-forward svc/prometheus-server 9090:80
              http://localhost:9090

  Grafana     kubectl -n monitoring port-forward svc/grafana 3000:80
              http://localhost:3000
              admin / ${GRAFANA_PW}

  Verify the NexOps scrape target is up:
    http://localhost:9090/targets  -> look for kubernetes-pods / nexops

SUMMARY
