# task-management frontend (Vite + React SPA)
# Build context: task-management/apps/frontend directory
# docker-compose usage:
#   build:
#     context: ./apps/frontend
#     dockerfile: Dockerfile

# ─── Stage 1: Build the SPA ─────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Copy manifest files first for optimal layer caching
COPY package.json bun.lock* ./

# Install all deps (devDeps needed for vite build + tsc)
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

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
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
