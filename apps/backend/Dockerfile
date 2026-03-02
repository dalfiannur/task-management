# task-management backend
# Build context: monorepo root
# docker-compose usage:
#   build:
#     context: ..
#     dockerfile: task-management/apps/backend/Dockerfile

# ─── Stage 1: Install dependencies ─────────────────────────────────────────
FROM oven/bun:1.3.8-alpine AS deps

WORKDIR /build

# Copy sedjiwa-permissions at its monorepo-relative path so the backend's
# "file:../../../sedjiwa-permissions" dependency resolves correctly.
COPY sedjiwa-permissions/ ./sedjiwa-permissions/

# Copy ONLY the backend's package.json (no workspace root package.json).
# Without a workspace root, bun treats this as a standalone package and
# produces a flat node_modules with all transitive deps at the top level.
COPY task-management/apps/backend/package.json ./task-management/apps/backend/

WORKDIR /build/task-management/apps/backend

RUN bun install --production

# Patch bunsane maskError to pass through known safe GraphQLError codes in production
# (bunsane blindly masks ALL errors as INTERNAL_SERVER_ERROR in production mode)
RUN bun -e '\
  const f = "node_modules/bunsane/gql/index.ts"; \
  let s = await Bun.file(f).text(); \
  s = s.replace( \
    /if \(process\.env\.NODE_ENV === .production.\) \{/, \
    `const SAFE_CODES = new Set(["NOT_FOUND","BAD_USER_INPUT","FORBIDDEN","UNAUTHENTICATED","BAD_REQUEST","VALIDATION_ERROR","CONFLICT","INTERNAL_ERROR"]);\n    if (error instanceof GraphQLError && SAFE_CODES.has(error.extensions?.code)) { return error; }\n    if (process.env.NODE_ENV === "production") {` \
  ); \
  await Bun.write(f, s);'

# Dereference symlinks and flatten nested node_modules to prevent duplicate
# package instances at runtime.
RUN cp -rL node_modules /build/resolved_node_modules \
    && find /build/resolved_node_modules -mindepth 2 -name node_modules -type d -exec rm -rf {} + 2>/dev/null || true

# ─── Stage 2: Runtime image ─────────────────────────────────────────────────
FROM oven/bun:1.3.8-alpine AS runtime

RUN apk add --no-cache wget

WORKDIR /app

# Copy dereferenced node_modules (no dangling symlinks)
COPY --from=deps /build/resolved_node_modules ./node_modules/

# Copy application source
COPY task-management/apps/backend/ .

RUN chown -R bun:bun /app 2>/dev/null || true
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/graphql || exit 1

CMD ["bun", "src/index.ts"]
