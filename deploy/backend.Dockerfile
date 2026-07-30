# backend-rs runtime image — the Rust binary is built ON THE HOST (its Cargo.toml
# uses local path deps outside the repo, so it can't build in an isolated context)
# and copied in here. See deploy/build.sh / deploy/README.md.
#
# Runtime deps come straight from `ldd target/release/app`: glibc (<=2.34 symbols,
# so bookworm's 2.36 is fine), OpenSSL 3, zlib, zstd, brotli.
FROM docker.io/library/debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        zlib1g \
        libzstd1 \
        libbrotli1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Prebuilt binaries copied from deploy/bin/ (built on host by build.sh)
COPY bin/app /usr/local/bin/app
COPY bin/seed_admin /usr/local/bin/seed_admin

EXPOSE 3010

# Backend binds 0.0.0.0:$PORT (default 3010). Config comes from env (compose).
CMD ["app"]
