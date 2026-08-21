#!/usr/bin/env bash
# Build both images from source and tag them for the local stack and for ghcr.
#
#   ./build.sh            build + tag
#   ./build.sh --push     build + tag + push to ghcr.io
#
# Pushing needs a prior `podman login ghcr.io -u <user>` with a token carrying
# write:packages. This script never handles the token.
#
# Unlike the previous scheme, nothing is compiled on the host: the Rust binaries
# and the SPA are both produced inside their builder stages. The one thing the
# host still does is stage the backend's build context, because backend-rs
# depends on the arke crates that live in a sibling checkout outside this repo.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
ARKE="${ARKE_DIR:-$(cd "$ROOT/../rust-ecs" && pwd)}"

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
if [[ -n "$(git -C "$ROOT" status --porcelain -- apps deploy)" \
   || -n "$(git -C "$ARKE" status --porcelain)" ]]; then
    SHA="${SHA}-dirty"
fi

echo "==> Building ${REGISTRY}/{backend,frontend}:${SHA}"

# ── Backend context ──────────────────────────────────────────────────────────
# Two checkouts side by side, which is what makes the manifest's relative
# `../../../rust-ecs` resolve inside the image.
#
# Copied via `git ls-files`, not `git archive`: ls-files walks the index but
# reads the files as they are on disk, so uncommitted edits ship, while
# everything git ignores — target/, node_modules/ — stays out. `git archive`
# would export HEAD instead and silently omit work in progress.
CTX="$DEPLOY_DIR/.build-context"
echo "==> Staging backend build context -> ${CTX}"
rm -rf "$CTX"
mkdir -p "$CTX/rust-ecs" "$CTX/task-management"
# -C must precede -T: GNU tar applies directory changes positionally, and a -C
# after -T silently does nothing.
git -C "$ARKE" ls-files -z \
    | tar -c -C "$ARKE" -f - --null -T - \
    | tar -x -C "$CTX/rust-ecs"
git -C "$ROOT" ls-files -z -- apps/backend-rs \
    | tar -c -C "$ROOT" -f - --null -T - \
    | tar -x -C "$CTX/task-management"

echo "==> Building backend image (compiles Rust from scratch — expect minutes)…"
"$ENGINE" build \
    -f "$DEPLOY_DIR/backend.Dockerfile" \
    -t "${REGISTRY}/backend:${SHA}" \
    -t "${REGISTRY}/backend:latest" \
    -t "taskmgmt/backend-rs:local" \
    "$CTX"

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

rm -rf "$CTX"

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
