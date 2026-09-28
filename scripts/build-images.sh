#!/usr/bin/env bash
# Builds the frontend and backend images locally.
#
#   ./scripts/build-images.sh              -> tags :local
#   IMAGE_TAG=1.0.3 ./scripts/build-images.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker

IMAGE_TAG="${IMAGE_TAG:-local}"
DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-}"

# Two names per image: the short one kind loads, and the registry-qualified one
# the pipeline pushes. Same layers, two tags, no second build.
BACKEND_LOCAL="nexops-backend:${IMAGE_TAG}"
FRONTEND_LOCAL="nexops-frontend:${IMAGE_TAG}"

step "Building ${BACKEND_LOCAL}"
docker build -t "${BACKEND_LOCAL}" "${REPO_ROOT}/backend"
ok "backend built"

step "Building ${FRONTEND_LOCAL}"
docker build -t "${FRONTEND_LOCAL}" "${REPO_ROOT}/frontend"
ok "frontend built"

if [[ -n "${DOCKERHUB_USERNAME}" ]]; then
  step "Tagging for Docker Hub (${DOCKERHUB_USERNAME})"
  docker tag "${BACKEND_LOCAL}"  "${DOCKERHUB_USERNAME}/nexops-backend:${IMAGE_TAG}"
  docker tag "${FRONTEND_LOCAL}" "${DOCKERHUB_USERNAME}/nexops-frontend:${IMAGE_TAG}"
  ok "tagged ${DOCKERHUB_USERNAME}/nexops-{backend,frontend}:${IMAGE_TAG}"
  info "push with: ./scripts/push-images.sh"
fi

step "Images"
docker images | grep -E 'REPOSITORY|nexops' || true
