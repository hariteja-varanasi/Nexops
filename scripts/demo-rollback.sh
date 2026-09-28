#!/usr/bin/env bash
# Rollback demonstration: v1.0 -> v1.1 -> v1.2(broken) -> rollback -> v1.1
#
# Shows both rollback paths and the difference between them:
#   kubectl rollout undo   fast, imperative, leaves Git out of sync
#   git revert             slower, declarative, Git stays the source of truth
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NAMESPACE="${NAMESPACE:-nexops-dev}"
DEPLOY="${DEPLOY:-nexops-backend}"

need kubectl

history() {
  echo
  kubectl -n "${NAMESPACE}" rollout history deployment/"${DEPLOY}"
  kubectl -n "${NAMESPACE}" get deployment "${DEPLOY}" \
    -o jsonpath='{"running image: "}{.spec.template.spec.containers[0].image}{"\n"}'
}

step "Current state"
history

step "Simulating three releases"
for v in 1.1 1.2; do
  info "rolling out ${v}"
  # An annotation change is enough to create a new ReplicaSet revision without
  # needing three real image builds for the demo.
  kubectl -n "${NAMESPACE}" patch deployment "${DEPLOY}" \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"nexops.io/version\":\"${v}\"}}}}}"
  kubectl -n "${NAMESPACE}" annotate deployment "${DEPLOY}" \
    kubernetes.io/change-cause="deploy version ${v}" --overwrite >/dev/null
  kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOY}" --timeout=180s
done
history

step "Releasing a broken version"
kubectl -n "${NAMESPACE}" set image deployment/"${DEPLOY}" \
  backend="nexops-backend:does-not-exist" >/dev/null
kubectl -n "${NAMESPACE}" annotate deployment "${DEPLOY}" \
  kubernetes.io/change-cause="deploy version 1.3 (broken image)" --overwrite >/dev/null

info "the rollout will stall — watch for ImagePullBackOff"
kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOY}" --timeout=60s || true
kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=backend

cat <<'NOTE'

    The application is still serving. maxUnavailable: 0 held the working pods
    in place because the replacement never became ready. A broken deploy
    stalled instead of causing an outage.

NOTE

step "Rolling back"
kubectl -n "${NAMESPACE}" rollout undo deployment/"${DEPLOY}"
kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOY}" --timeout=180s
ok "rolled back to the previous working revision"
history

step "To a specific revision instead"
cat <<'NOTE'
    kubectl -n nexops-dev rollout history deployment/nexops-backend
    kubectl -n nexops-dev rollout undo deployment/nexops-backend --to-revision=2

    revisionHistoryLimit: 5 in the Deployment is what makes this possible.
    Set it to 0 and there is nothing to roll back to.

NOTE

step "The same rollback under GitOps"
cat <<'NOTE'
    What you just ran changed the cluster directly. Argo CD will notice the
    cluster no longer matches Git and, with selfHeal enabled, push the broken
    version straight back within seconds.

    Under GitOps the rollback is a commit:

      git log --oneline -- gitops/dev/values.yaml
      git revert <the tag-bump commit>
      git push

    Argo CD syncs to the reverted state and it stays reverted, because Git —
    not the cluster — is the source of truth.

    In an incident, argocd app rollback nexops-prod is the fast path. Follow it
    with the Git revert, or the next sync undoes your fix.

    You can also see all of this in the NexOps UI:
      Applications -> nexops-backend -> Roll back
      Deployments  -> the new ROLLED_BACK entry with its pipeline stages

NOTE
