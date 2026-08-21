# frontend image — the SPA is built from source inside the image.
#
# Build context is the repository root (not deploy/), because the bun workspace
# lockfile lives there and `--frozen-lockfile` resolves against the whole
# workspace. See the root .dockerignore for what is kept out of the context —
# without it the context would include apps/backend-rs/target, which is
# gigabytes.

# ─── Stage 1: build the SPA ──────────────────────────────────────────────────
FROM docker.io/oven/bun:1.3.8-alpine AS builder

WORKDIR /build

# Manifests first, so a source-only change reuses the cached install layer.
# apps/backend is the retired Bun service and nothing here imports it, but the
# workspace is declared as `apps/*` and --frozen-lockfile refuses to proceed
# unless every member's manifest is present to match the lockfile against.
COPY package.json bun.lock ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/

RUN bun install --frozen-lockfile

COPY apps/frontend/ ./apps/frontend/

WORKDIR /build/apps/frontend

# Baked into the bundle at build time; falls back to the in-app default when
# unset. Override with --build-arg VITE_APP_NAME="Acme Tasks".
ARG VITE_APP_NAME
ENV VITE_APP_NAME=$VITE_APP_NAME

# `bun run build` is vite build + tsc, so a type error fails the image build.
RUN bun run build

# ─── Stage 2: serve ──────────────────────────────────────────────────────────
FROM docker.io/library/nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=builder /build/apps/frontend/dist /usr/share/nginx/html

# The compose-stack config: proxies /api/tasks-rs/ to the backend-rs service and
# falls back to index.html so client-side routes (/setup, /admin/users, …) load
# on a hard refresh. Deliberately NOT apps/frontend/nginx.conf, which still
# targets the retired Bun backend and the wider sedjiwa stack.
COPY deploy/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
