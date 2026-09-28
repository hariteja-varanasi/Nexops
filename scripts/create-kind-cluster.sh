#!/usr/bin/env bash
# Creates the kind cluster, the ingress controller, metrics-server and the
# three NexOps namespaces. Safe to re-run: an existing cluster is reused.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker
need kind
need kubectl

step "Cluster: ${CLUSTER_NAME}"
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  ok "cluster already exists, reusing it"
else
  kind create cluster --name "${CLUSTER_NAME}" --config "${REPO_ROOT}/kind-config.yaml" --wait 120s
  ok "cluster created"
fi

kubectl cluster-info --context "kind-${CLUSTER_NAME}" >/dev/null
kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
ok "kubectl context set to kind-${CLUSTER_NAME}"

step "NGINX Ingress controller"
# The "kind" flavour of the manifest uses a NodePort + hostPort binding, which
# is what makes the extraPortMappings in kind-config.yaml work.
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.2/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx wait --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s \
  || warn "ingress controller is slow to start; check: kubectl -n ingress-nginx get pods"
ok "ingress-nginx ready on host ports 80 and 443"

step "metrics-server"
# kind's kubelets serve their metrics endpoint with a self-signed certificate,
# so metrics-server needs --kubelet-insecure-tls or it never becomes ready.
# This is a kind-specific concession, not something to copy to a real cluster.
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/metrics-server/v0.7.2/deploy/components.yaml
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' \
  2>/dev/null || info "metrics-server already patched"
kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s \
  || warn "metrics-server not ready; kubectl top and the HPA will not work yet"

step "Namespaces"
kubectl apply -f "${REPO_ROOT}/kubernetes/namespace/namespaces.yaml"
kubectl get namespaces -l app.kubernetes.io/part-of=nexops

step "Cluster is up"
kubectl get nodes -o wide
cat <<SUMMARY

  Context      kind-${CLUSTER_NAME}
  Nodes        $(kubectl get nodes --no-headers | wc -l)
  Namespaces   nexops-dev, nexops-staging, nexops-prod
  Ingress      http://localhost  (and http://<ec2-public-ip>)

  Next: ./scripts/build-images.sh && ./scripts/load-images.sh

SUMMARY
