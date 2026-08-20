# Local deploy (self-contained podman stack)

Runs the task-management app — Rust `backend-rs` + Vite SPA — as an **isolated**
stack: its own PostgreSQL, its own rustfs (S3), on a private network. It does not
touch the wider sedjiwa podman stack (`sedjiwa-net`).

## Services & host ports

| Service     | Image                          | Host port | Notes                                  |
|-------------|--------------------------------|-----------|----------------------------------------|
| frontend    | nginx + built SPA              | **3011**  | open http://localhost:3011             |
| backend-rs  | debian-slim + host-built binary| 3010      | 127.0.0.1 only (debug); proxied by nginx |
| postgres    | postgres:17-alpine             | 5433      | 127.0.0.1 only (debug)                 |
| rustfs      | rustfs:latest                  | 9100/9101 | 9100 = S3 API, 9101 = console          |

Admin login (seeded): phone **0800000000** / password **admin12345**.

## Why the binary is built on the host

`apps/backend-rs/Cargo.toml` uses local **path** dependencies that live outside
this repo (`arke`, `arke-postgres` under `~/Workspace/personal/rust-ecs`). An
isolated Docker build context can't see them, so the release binary is compiled
on the host and copied into a thin `debian:bookworm-slim` image. The SPA is built
on the host the same way (bun) and served by nginx.

## Usage

```bash
cd deploy

# 1. Build host artifacts (cargo + bun) into ./bin and ./web
./build.sh

# 2. Build images and start the stack
podman-compose up -d --build

# logs / status
podman-compose ps
podman-compose logs -f backend-rs

# stop (keep data)
podman-compose down

# stop + wipe postgres/rustfs volumes
podman-compose down -v
```

Re-run `./build.sh` after changing backend or frontend source, then
`podman-compose up -d --build` to redeploy.

## Media / presigned S3 URLs

Media uploads/downloads use presigned S3 URLs, which are **absolute**. So the
backend signs them with `S3_ENDPOINT`, and the browser must be able to reach that
exact host:port. We use the host LAN IP (`HOST_LAN_IP`, default `192.168.33.111`)
because it's reachable both from the browser and from the backend container. If
your machine's IP differs, set it:

```bash
HOST_LAN_IP=192.168.x.y podman-compose up -d --build
```

Those uploads are cross-origin (SPA on `:3011` → rustfs on `:9100`), so the
`createbucket` one-shot also writes a bucket CORS rule allowing the three SPA
origins. Without it the preflight comes back with no `Access-Control-Allow-Origin`
and uploads fail before any bytes move. Change `HOST_LAN_IP` and the rule follows,
but re-run `podman-compose up createbucket` so it is re-applied. The rest of the
app (auth, projects, tasks, comments, notifications, etc.) is same-origin through
nginx and unaffected.

For local dev — SPA on `:3001`, backend on the host, rustfs shared with the wider
sedjiwa stack — the equivalent step is `apps/backend-rs/scripts/setup-s3-cors.sh`,
and `S3_ACCESS_KEY`/`S3_SECRET_KEY` in `apps/backend-rs/.env` must match that
rustfs (`rustfsadmin`), not the `minioadmin` default.
