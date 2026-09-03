# backend-rs image — compiled from source inside the image.
#
# Build context is NOT this repo. `deploy/build.sh` stages a directory that
# holds two checkouts side by side:
#
#   <context>/rust-ecs/                        arke + arke-postgres
#   <context>/task-management/apps/backend-rs/ this service
#
# That layout is what makes the manifest's `../../../rust-ecs` resolve: from
# apps/backend-rs, three levels up is the context root. The same three levels
# resolve on a developer machine, so nothing about local builds changes.
#
# Staging comes from `git archive HEAD` in both repos, so **uncommitted work in
# rust-ecs is not in the image**. Commit it there first if you meant to ship it.

# ─── Stage 1: compile ────────────────────────────────────────────────────────
# Pinned to the toolchain the service is developed against; arke needs >= 1.88.
# Kept in lockstep with `toolchain:` in .github/workflows/publish-images.yml —
# CI must test on the same toolchain that builds this image. Bump both.
FROM docker.io/library/rust:1.97-bookworm AS builder

# transport/build.rs compiles the .proto files, which needs protoc on PATH.
RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY rust-ecs/ ./rust-ecs/
COPY task-management/ ./task-management/

WORKDIR /src/task-management/apps/backend-rs
# --locked: fail rather than silently resolve a different dependency graph than
# the Cargo.lock that was tested.
RUN cargo build --release --locked --bin app --bin seed_admin

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# Runtime deps are what `ldd target/release/app` asks for: glibc, OpenSSL 3,
# zlib, zstd, brotli. bookworm's glibc 2.36 covers the binary's <= 2.34 symbols.
FROM docker.io/library/debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        zlib1g \
        libzstd1 \
        libbrotli1 \
        # For container healthchecks. The service speaks Connect, so a probe is
        # a POST with a JSON body — there is no GET endpoint to curl and no
        # shell builtin that will do it: this base image ships dash, which has
        # no /dev/tcp. Without wget the healthcheck can only ever fail, and any
        # compose that waits on `service_healthy` never starts what follows.
        wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 app

COPY --from=builder /src/task-management/apps/backend-rs/target/release/app /usr/local/bin/app
COPY --from=builder /src/task-management/apps/backend-rs/target/release/seed_admin /usr/local/bin/seed_admin

# Nothing here needs root: the service binds 3010, well above the privileged range.
USER app
WORKDIR /home/app

EXPOSE 3010

# Binds 0.0.0.0:$PORT (default 3010). All configuration arrives via env.
CMD ["app"]
