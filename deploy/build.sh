#!/usr/bin/env bash
# Build the host-side artifacts the compose images copy in:
#   - backend-rs release binaries (app, seed_admin)  -> deploy/bin/
#   - frontend SPA (vite build)                        -> deploy/web/
#
# backend-rs is built on the host because its Cargo.toml depends on local path
# crates outside this repo (arke, arke-postgres), which an isolated Docker build
# context can't see.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

echo "==> Building backend-rs release binaries (cargo)…"
cargo build --release --manifest-path "$ROOT/apps/backend-rs/Cargo.toml" \
    --bin app --bin seed_admin

echo "==> Copying binaries -> deploy/bin/"
mkdir -p "$DEPLOY_DIR/bin"
cp "$ROOT/apps/backend-rs/target/release/app" \
   "$ROOT/apps/backend-rs/target/release/seed_admin" \
   "$DEPLOY_DIR/bin/"

echo "==> Building frontend SPA (bun run build)…"
# VITE_APP_NAME (if set in the environment) is baked into the SPA at build time;
# it falls back to the default in the app when unset. Override e.g.:
#   VITE_APP_NAME="Acme Tasks" ./build.sh
echo "    VITE_APP_NAME=${VITE_APP_NAME:-<default: Sedjiwa · Tasks>}"
( cd "$ROOT/apps/frontend" && bun run build )

echo "==> Copying dist -> deploy/web/"
rm -rf "$DEPLOY_DIR/web"
cp -r "$ROOT/apps/frontend/dist" "$DEPLOY_DIR/web"

echo "==> Artifacts ready. Next:"
echo "    cd $DEPLOY_DIR && podman-compose up -d --build"
