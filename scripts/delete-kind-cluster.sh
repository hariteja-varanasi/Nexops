#!/usr/bin/env bash
# Tears the cluster down. The Docker images built locally are kept, so a
# rebuild after this is fast.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need kind

if ! kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  info "no cluster named ${CLUSTER_NAME}; nothing to do"
  exit 0
fi

if [[ "${FORCE:-}" != "yes" ]]; then
  read -r -p "Delete cluster '${CLUSTER_NAME}' and everything in it? [y/N] " reply
  [[ "${reply}" =~ ^[Yy]$ ]] || { info "cancelled"; exit 0; }
fi

step "Deleting cluster ${CLUSTER_NAME}"
kind delete cluster --name "${CLUSTER_NAME}"
ok "cluster deleted"

info "PersistentVolume data lived inside the node containers and is gone with them."
info "Docker images are untouched: docker images | grep nexops"
