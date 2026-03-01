# task-management frontend (Vite + React SPA)
# Build context: monorepo root (workspace-aware build)
# docker-compose usage:
#   build:
#     context: ..
#     dockerfile: task-management/apps/frontend/Dockerfile

# ─── Stage 1: Build the SPA ─────────────────────────────────────────────────
FROM oven/bun:1.3.8-alpine AS builder

WORKDIR /build

# task-management is a bun workspace — must replicate full workspace structure
# so the workspace lockfile resolves correctly with --frozen-lockfile
COPY task-management/package.json ./task-management/
COPY task-management/bun.lock ./task-management/
COPY task-management/apps/frontend/package.json ./task-management/apps/frontend/
COPY task-management/apps/backend/package.json ./task-management/apps/backend/

WORKDIR /build/task-management

# Install all deps (devDeps needed for vite build + tsc)
RUN bun install --frozen-lockfile

WORKDIR /build/task-management/apps/frontend

# Copy application source
COPY task-management/apps/frontend/ .

# Use relative API URLs — nginx proxies at runtime
ENV VITE_API_URL=""

# OIDC config baked at build time — MUST be provided via --build-arg or
# docker-compose build.args. No default: build fails explicitly if omitted.
ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY
ENV VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
RUN test -n "$VITE_OIDC_AUTHORITY" || (echo "ERROR: VITE_OIDC_AUTHORITY build arg is required" && exit 1)

# Media upload base URL — must match nginx proxy prefix for tasks-backend
# use-media.ts strips "/graphql" to get "/api-tasks" for REST upload endpoints
ENV VITE_API_BASE_URL="/api-tasks/graphql"

RUN bun run build

# ─── Stage 2: Serve with nginx ───────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy built SPA assets
COPY --from=builder /build/task-management/apps/frontend/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY task-management/apps/frontend/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
