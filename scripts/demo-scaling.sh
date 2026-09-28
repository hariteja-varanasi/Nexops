#!/usr/bin/env bash
# Scaling demonstration: 1 pod -> 2 -> 3, visible in Kubernetes, in the NexOps
# UI and in Grafana.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NAMESPACE="${NAMESPACE:-nexops-dev}"
DEPLOY="${DEPLOY:-nexops-backend}"

need kubectl

show() {
  echo
  kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=backend -o wide
  echo
  kubectl -n "${NAMESPACE}" get deployment "${DEPLOY}" \
    -o custom-columns='DEPLOYMENT:.metadata.name,DESIRED:.spec.replicas,READY:.status.readyReplicas,AVAILABLE:.status.availableReplicas'
}

step "Starting state"
show

for n in 1 2 3; do
  step "Scaling to ${n} replica$([ "$n" -ne 1 ] && echo s)"
  kubectl -n "${NAMESPACE}" scale deployment "${DEPLOY}" --replicas="${n}"
  kubectl -n "${NAMESPACE}" rollout status deployment "${DEPLOY}" --timeout=120s
  show
  info "note the NODE column: the scheduler spreads pods across both kind workers"
  sleep 3
done

step "Where else this is visible"
cat <<'NOTE'
    NexOps UI   Applications -> nexops-backend -> the Pods figure
    Grafana     NexOps Kubernetes dashboard -> "Replicas: desired vs available"
    Prometheus  kube_deployment_status_replicas_available{namespace="nexops-dev"}
NOTE

step "Autoscaling"
if kubectl -n "${NAMESPACE}" get hpa >/dev/null 2>&1; then
  kubectl -n "${NAMESPACE}" get hpa
  cat <<'NOTE'

    The HPA now owns the replica count, so it will pull it back toward
    minReplicas within about 5 minutes (the scale-down stabilisation window).
    That is not a bug — it is the autoscaler correcting a manual change, the
    same way Argo CD corrects a manual manifest edit.

    To watch it scale UP instead, generate load:

      kubectl -n nexops-dev run load --rm -it --image=busybox --restart=Never -- \
        sh -c 'while true; do wget -q -O- http://nexops-backend:4000/api/health >/dev/null; done'

      kubectl -n nexops-dev get hpa -w

NOTE
else
  warn "no HPA found; metrics-server may not be installed"
fi
