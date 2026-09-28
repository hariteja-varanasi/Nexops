#!/usr/bin/env bash
# Pushes the images to Docker Hub. Jenkins does this in the pipeline; this
# script is for doing it by hand the first time.
#
#   export DOCKERHUB_USERNAME=ravinadh777
#   echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
#   IMAGE_TAG=1.0.0 ./scripts/push-images.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker

IMAGE_TAG="${IMAGE_TAG:-local}"
: "${DOCKERHUB_USERNAME:?set DOCKERHUB_USERNAME to your Docker Hub account}"

docker info 2>/dev/null | grep -q "Username:" \
  || warn "not logged in to Docker Hub; run: docker login -u ${DOCKERHUB_USERNAME}"

for name in backend frontend; do
  local_image="nexops-${name}:${IMAGE_TAG}"
  remote="${DOCKERHUB_USERNAME}/nexops-${name}:${IMAGE_TAG}"

  docker image inspect "${local_image}" >/dev/null 2>&1 \
    || die "${local_image} not built. Run ./scripts/build-images.sh"

  step "Pushing ${remote}"
  docker tag "${local_image}" "${remote}"
  docker push "${remote}"

  # `latest` as well, so the dev and staging overlays keep working.
  if [[ "${IMAGE_TAG}" != "latest" ]]; then
    docker tag "${local_image}" "${DOCKERHUB_USERNAME}/nexops-${name}:latest"
    docker push "${DOCKERHUB_USERNAME}/nexops-${name}:latest"
  fi
  ok "${remote} pushed"
done

cat <<NOTE

    Pushed:
      https://hub.docker.com/r/${DOCKERHUB_USERNAME}/nexops-backend/tags
      https://hub.docker.com/r/${DOCKERHUB_USERNAME}/nexops-frontend/tags

    Never put the Docker Hub token in a file in this repo. Use
    'docker login' locally and the Jenkins credentials store in CI.

NOTE
