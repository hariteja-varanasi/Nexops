#!/usr/bin/env bash
# Loads locally-built images straight into the kind nodes.
#
# Why this exists: kind nodes have their own container runtime and cannot see
# the host's Docker images. Without this step every pod sits in ErrImagePull
# even though `docker images` shows the image right there. This is the single
# most common thing to get stuck on with kind.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker
need kind

IMAGE_TAG="${IMAGE_TAG:-local}"

kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}" \
  || die "cluster '${CLUSTER_NAME}' does not exist. Run ./scripts/create-kind-cluster.sh"

for image in "nexops-backend:${IMAGE_TAG}" "nexops-frontend:${IMAGE_TAG}"; do
  docker image inspect "${image}" >/dev/null 2>&1 \
    || die "${image} not found locally. Run ./scripts/build-images.sh first."
  step "Loading ${image} into kind"
  kind load docker-image "${image}" --name "${CLUSTER_NAME}"
  ok "${image} loaded"
done

step "Verifying the nodes can see them"
for node in $(kind get nodes --name "${CLUSTER_NAME}"); do
  count=$(docker exec "${node}" crictl images 2>/dev/null | grep -c nexops || true)
  info "${node}: ${count} nexops image(s)"
done

cat <<'NOTE'

    Because these images are loaded rather than pulled, the Deployments must use
    imagePullPolicy: IfNotPresent. With Always, Kubernetes ignores the local
    copy and tries the registry anyway.

NOTE
