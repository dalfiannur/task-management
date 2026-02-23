# task-management backend
# Build context: task-management/apps/backend directory
# docker-compose usage:
#   build:
#     context: ./apps/backend
#     dockerfile: Dockerfile

# ─── Stage 1: Install dependencies ─────────────────────────────────────────
FROM oven/bun:1.2-alpine AS deps

WORKDIR /build

# Copy only manifest files for layer caching
COPY package.json bun.lock* ./

# Install production deps only (no devDeps needed at runtime)
RUN bun install --frozen-lockfile --production

# ─── Stage 2: Runtime image ─────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS runtime

RUN apk add --no-cache wget

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /build/node_modules ./node_modules/

# Copy application source
COPY . .

RUN chown -R bun:bun /app 2>/dev/null || true
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/graphql || exit 1

CMD ["bun", "src/index.ts"]
