#!/usr/bin/env bash
# Controlled failure demonstration.
#
# Breaks the backend's database connection on purpose, then walks through how
# each layer reports it: readiness probe -> pod not ready -> Service removes
# the endpoint -> Grafana -> Loki -> fix -> healthy.
#
#   ./scripts/demo-failure.sh          break it
#   ./scripts/demo-failure.sh --fix    put it back
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NAMESPACE="${NAMESPACE:-nexops-dev}"
DEPLOY="${DEPLOY:-nexops-backend}"

need kubectl

if [[ "${1:-}" == "--fix" ]]; then
  step "Restoring the correct DATABASE_URL"
  kubectl -n "${NAMESPACE}" set env deployment/"${DEPLOY}" DATABASE_URL- >/dev/null
  kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOY}" --timeout=180s
  kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=backend
  ok "backend healthy again"
  cat <<'NOTE'

    In a real incident the fix would not be a kubectl command. It would be a
    commit: correct the value in gitops/dev/values.yaml, push, and let Jenkins
    and Argo CD carry it to the cluster. The kubectl version is faster for a
    demo and leaves the cluster out of sync with Git — Argo CD's selfHeal will
    revert it, which is itself worth watching.

NOTE
  exit 0
fi

step "Before: healthy"
kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=backend
kubectl -n "${NAMESPACE}" get endpoints nexops-backend

step "Breaking it: pointing DATABASE_URL at a host that does not exist"
# An env var override, not a code change: the image is fine, the configuration
# is wrong. That is what most real outages look like.
kubectl -n "${NAMESPACE}" set env deployment/"${DEPLOY}" \
  DATABASE_URL="postgresql://nexops:wrong@postgres-typo:5432/nexops"

info "watching the rollout fail (this will not complete — that is the point)"
kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOY}" --timeout=90s || true

step "1. Readiness probe"
kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=backend
echo
kubectl -n "${NAMESPACE}" describe pod -l app.kubernetes.io/component=backend \
  | grep -A3 "Readiness probe failed" | head -12 || info "check 'kubectl describe pod' for probe events"

step "2. The Service drops the pod"
kubectl -n "${NAMESPACE}" get endpoints nexops-backend
info "a not-ready pod is removed from the Service, so it receives no traffic"

step "3. What the API itself says"
kubectl -n "${NAMESPACE}" exec deploy/"${DEPLOY}" -c backend -- \
  sh -c 'wget -qO- http://127.0.0.1:4000/api/health || true' 2>/dev/null \
  | head -3 || info "the pod may not be up enough to exec into"

step "4. In the logs"
kubectl -n "${NAMESPACE}" logs -l app.kubernetes.io/component=backend --tail=15 2>/dev/null \
  | grep -i "error\|econnrefused\|getaddrinfo" | head -5 || info "see: kubectl logs"

cat <<'INVESTIGATE'

    ────────────────────────────────────────────────────────────────
    Now investigate it the way you would a real incident
    ────────────────────────────────────────────────────────────────

    Grafana   NexOps Application dashboard
              "Error rate" climbs, "Requests per second" falls to zero

    Loki      Explore, Loki data source:
                {namespace="nexops-dev"} | json | level="ERROR"
              The getaddrinfo failure for postgres-typo is right there.

    NexOps    Incidents page: open one against nexops-backend, severity
              CRITICAL, and describe what you found. That is the workflow
              the Incidents page exists for.

    kubectl   kubectl -n nexops-dev describe pod -l app.kubernetes.io/component=backend
              kubectl -n nexops-dev get events --sort-by=.lastTimestamp | tail -20

    What did NOT happen, and why it matters:
      - The old pods were never terminated. maxUnavailable: 0 means Kubernetes
        would not remove a healthy pod until a new one became ready, and the
        new one never did. The application kept serving throughout.
      - Liveness did not restart anything. Liveness checks /api/health/live,
        which does not touch the database, so a database problem does not turn
        into a restart loop. This distinction is the whole reason for having
        two different probes.

    Fix it:  ./scripts/demo-failure.sh --fix

INVESTIGATE
