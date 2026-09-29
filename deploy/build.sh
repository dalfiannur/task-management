#!/usr/bin/env bash
# Build both images from source and tag them for the local stack and for ghcr.
#
#   ./build.sh            build + tag
#   ./build.sh --push     build + tag + push to ghcr.io
#
# Pushing needs a prior `podman login ghcr.io -u <user>` with a token carrying
# write:packages. This script never handles the token.
#
# Nothing is compiled on the host: the Rust binaries and the SPA are both
# produced inside their builder stages, each with the repository root as its
# build context.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

REGISTRY="${REGISTRY:-ghcr.io/dalfiannur/task-management}"
ENGINE="${ENGINE:-podman}"
PUSH=0
[[ "${1:-}" == "--push" ]] && PUSH=1

# Tag every image with the commit it was built from, so a running container can
# always be traced back to a revision. `latest` is what the compose stack uses.
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
# Images are built from the WORKING TREE, not from HEAD, so what you are looking
# at is what ships. When that differs from the commit, the tag has to say so —
# a bare SHA on an image containing uncommitted work is a lie that outlives the
# session that produced it.
if [[ -n "$(git -C "$ROOT" status --porcelain -- apps deploy)" ]]; then
    SHA="${SHA}-dirty"
fi

echo "==> Building ${REGISTRY}/{backend,frontend}:${SHA}"

# ── Backend ──────────────────────────────────────────────────────────────────
echo "==> Building backend image (compiles Rust from scratch — expect minutes)…"
"$ENGINE" build \
    -f "$DEPLOY_DIR/backend.Dockerfile" \
    -t "${REGISTRY}/backend:${SHA}" \
    -t "${REGISTRY}/backend:latest" \
    -t "taskmgmt/backend-rs:local" \
    "$ROOT"

# ── Frontend ─────────────────────────────────────────────────────────────────
# Context is the repo root; the root .dockerignore keeps target/ and
# node_modules out of it.
echo "==> Building frontend image…"
"$ENGINE" build \
    -f "$DEPLOY_DIR/frontend.Dockerfile" \
    ${VITE_APP_NAME:+--build-arg "VITE_APP_NAME=$VITE_APP_NAME"} \
    -t "${REGISTRY}/frontend:${SHA}" \
    -t "${REGISTRY}/frontend:latest" \
    -t "taskmgmt/frontend:local" \
    "$ROOT"

if [[ "$PUSH" -eq 1 ]]; then
    echo "==> Pushing to ${REGISTRY}…"
    for img in backend frontend; do
        "$ENGINE" push "${REGISTRY}/${img}:${SHA}"
        "$ENGINE" push "${REGISTRY}/${img}:latest"
    done
    echo "==> Pushed ${SHA} and latest."
else
    echo "==> Built and tagged. To publish:"
    echo "    podman login ghcr.io -u <github-user>   # token needs write:packages"
    echo "    $0 --push"
fi

echo "==> Run the local stack:  cd $DEPLOY_DIR && podman-compose up -d"
