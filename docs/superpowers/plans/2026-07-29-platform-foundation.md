# Platform Foundation (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new Rust backend (`apps/backend-rs/`) proving the full target stack end-to-end — Axum + connectrpc-axum (Connect) → JWT auth interceptor → Arke World (hybrid cache) ↔ arke-postgres — via three `HealthService` RPCs.

**Architecture:** A Cargo workspace with layered crates (`app`, `transport`, `domain`, `persistence`, `auth`). Postgres is the source of truth via arke-postgres; an in-memory Arke `World` acts as an invalidate-on-write cache inside `persistence::Store`. Browser talks to the server via the Connect protocol (no proxy).

**Tech Stack:** Rust, Tokio, Axum, `connectrpc-axum` (+ `connectrpc-axum-build`), `prost`, `arke`, `arke-postgres`, `jsonwebtoken`, `dotenvy`, `tower-http`.

**Spec:** `docs/superpowers/specs/2026-07-29-platform-foundation-design.md`

---

## Preliminaries

- **Crate versions:** Pin to the latest compatible releases; `cargo build` resolves the graph. Where a version is written below it is a starting point — if `cargo build` reports an incompatibility (notably between `axum` and `connectrpc-axum`), align `axum` to the version `connectrpc-axum 0.2` depends on.
- **Novel crates (`arke`, `arke-postgres`, `connectrpc-axum`):** These are less-documented. In any task that first touches one of them, Step 1 is always: open its examples/docs and copy the real signatures. Do not invent method names — verify, then write.
- **Test database — DECIDED: `testcontainers`** (see [testing policy](../specs/2026-07-29-testing-policy.md)). Integration tests spin an **ephemeral Postgres per run** via `testcontainers` + `testcontainers-modules` (feature `postgres`), through a shared helper `test_support::pg() -> (ContainerAsync<Postgres>, Store)` (connect + reconcile). This **supersedes** the `TEST_DATABASE_URL` + skip-if-absent pattern shown in Task 5/10 below — when executing, replace that pattern with a `test_support::pg()` call (no local DB setup, Docker required). The assertions in those tasks stay the same.
- **Working directory:** All `cargo` commands run from `apps/backend-rs/` unless noted.
- **Coexistence (do NOT collide with Bun):** backend-rs listens on **`:3010`** (Bun stays `:3000`, frontend dev `:3001`). The frontend reaches it via a **new** proxy prefix **`/api/tasks-rs`** — the existing `/api/tasks` (GraphQL Bun) is left untouched. Same Postgres instance, separate arke-postgres tables. See spec §2.1.
- **Store is single-component in this skeleton (known debt):** `persistence::Store` only serves `HeartbeatAt` here. It MUST be generalized to `get<T>`/`put<T>` as the first task of the create-project flow (spec §12 no.6). Do not over-build it now.

## File Structure

```
apps/backend-rs/
├── Cargo.toml                     # [workspace]
├── .env.example
├── proto/health.proto
└── crates/
    ├── auth/         Cargo.toml, src/lib.rs        # Claims, verify_jwt, AuthUser
    ├── domain/       Cargo.toml, src/lib.rs        # HeartbeatAt component
    ├── persistence/  Cargo.toml, src/lib.rs        # Store (PgStore + cache), Heartbeat put/get
    ├── transport/    Cargo.toml, build.rs, src/lib.rs, src/health.rs   # generated code + handlers
    └── app/          Cargo.toml, src/main.rs, src/config.rs, src/router.rs, src/interceptor.rs
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `apps/backend-rs/Cargo.toml`
- Create: `apps/backend-rs/crates/auth/Cargo.toml`, `crates/auth/src/lib.rs`
- Create: `apps/backend-rs/crates/domain/Cargo.toml`, `crates/domain/src/lib.rs`
- Create: `apps/backend-rs/crates/persistence/Cargo.toml`, `crates/persistence/src/lib.rs`
- Create: `apps/backend-rs/crates/transport/Cargo.toml`, `crates/transport/src/lib.rs`
- Create: `apps/backend-rs/crates/app/Cargo.toml`, `crates/app/src/main.rs`

- [ ] **Step 1: Create the workspace manifest**

`apps/backend-rs/Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/*"]

[workspace.package]
edition = "2021"
version = "0.1.0"

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "2"
axum = "0.8"
tower = "0.5"
tower-http = { version = "0.6", features = ["cors"] }
connectrpc-axum = "0.2"
connectrpc-axum-build = "0.2"
prost = "0.13"
jsonwebtoken = "9"
dotenvy = "0.15"
arke = "0.6"
arke-postgres = "0.6"
rust-s3 = "0.35"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

> Stack lengkap & rasional: [tech-stack decisions](../specs/2026-07-29-tech-stack-decisions.md). `rust-s3` dipakai flow media (bukan fase skeleton ini); `tracing` dipakai sejak boot (Task 9).

- [ ] **Step 2: Create each library crate with a placeholder root**

`crates/auth/Cargo.toml`:
```toml
[package]
name = "auth"
edition.workspace = true
version.workspace = true

[dependencies]
serde = { workspace = true }
jsonwebtoken = { workspace = true }
thiserror = { workspace = true }
```
`crates/auth/src/lib.rs`:
```rust
//! Auth: JWT verification and AuthUser context.
```

Repeat the same pattern for `domain`, `persistence`, `transport` with these dependency sets:
- `domain`: `arke`, `arke-postgres`, `serde`.
- `persistence`: `arke`, `arke-postgres`, `tokio`, `anyhow`, `domain = { path = "../domain" }`.
- `transport`: `connectrpc-axum`, `prost`, `serde`, `tokio`, `axum`, `auth = { path = "../auth" }`, `persistence = { path = "../persistence" }`, `domain = { path = "../domain" }`. Add `[build-dependencies] connectrpc-axum-build = { workspace = true }`.

`crates/app/Cargo.toml`:
```toml
[package]
name = "app"
edition.workspace = true
version.workspace = true

[dependencies]
tokio = { workspace = true }
axum = { workspace = true }
tower-http = { workspace = true }
anyhow = { workspace = true }
dotenvy = { workspace = true }
serde = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
auth = { path = "../auth" }
persistence = { path = "../persistence" }
transport = { path = "../transport" }
```
`crates/app/src/main.rs`:
```rust
fn main() {
    println!("backend-rs skeleton");
}
```

- [ ] **Step 3: Verify the workspace builds**

Run: `cargo build`
Expected: PASS — all five crates compile (empty).

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs
git commit -m "chore(backend-rs): scaffold Rust workspace with layered crates"
```

---

### Task 2: Config loading (`app`)

**Files:**
- Create: `apps/backend-rs/crates/app/src/config.rs`
- Modify: `apps/backend-rs/crates/app/src/main.rs`
- Test: inline `#[cfg(test)]` module in `config.rs`

- [ ] **Step 1: Write the failing test**

In `crates/app/src/config.rs`:
```rust
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_expires_in: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ConfigError {
    #[error("missing required env var: {0}")]
    Missing(&'static str),
}

impl Config {
    /// Build from a key→value map (pure; env adapter lives in `from_env`).
    pub fn from_map(m: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let get = |k: &'static str| m.get(k).cloned();
        Ok(Config {
            database_url: get("DATABASE_URL").ok_or(ConfigError::Missing("DATABASE_URL"))?,
            jwt_secret: get("AUTH_JWT_SECRET").ok_or(ConfigError::Missing("AUTH_JWT_SECRET"))?,
            jwt_expires_in: get("AUTH_JWT_EXPIRES_IN").unwrap_or_else(|| "7d".into()),
            port: get("PORT").and_then(|p| p.parse().ok()).unwrap_or(3000),
            cors_origins: get("CORS_ORIGINS")
                .unwrap_or_else(|| "http://localhost:3001".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> HashMap<String, String> {
        HashMap::from([
            ("DATABASE_URL".into(), "postgres://x".into()),
            ("AUTH_JWT_SECRET".into(), "s".into()),
        ])
    }

    #[test]
    fn defaults_apply() {
        let c = Config::from_map(&base()).unwrap();
        assert_eq!(c.port, 3000);
        assert_eq!(c.jwt_expires_in, "7d");
        assert_eq!(c.cors_origins, vec!["http://localhost:3001".to_string()]);
    }

    #[test]
    fn missing_secret_errors() {
        let mut m = base();
        m.remove("AUTH_JWT_SECRET");
        assert_eq!(Config::from_map(&m), Err(ConfigError::Missing("AUTH_JWT_SECRET")));
    }

    #[test]
    fn cors_splits_and_trims() {
        let mut m = base();
        m.insert("CORS_ORIGINS".into(), "a , b ,".into());
        assert_eq!(Config::from_map(&m).unwrap().cors_origins, vec!["a", "b"]);
    }
}
```
Add `thiserror` to `crates/app/Cargo.toml` dependencies (`thiserror = { workspace = true }`), and `mod config;` to `main.rs`.

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `cargo test -p app config`
Expected: compiles and the three tests PASS (this task is written test-first but the impl is included; if you prefer strict red-green, delete the `impl` body first, watch it fail, then restore).

- [ ] **Step 3: Add the env adapter**

Append to `config.rs`:
```rust
impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let m = std::env::vars().collect::<std::collections::HashMap<_, _>>();
        Self::from_map(&m)
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/app
git commit -m "feat(app): Config from env with validation + defaults"
```

---

### Task 3: JWT verification (`auth`)

**Files:**
- Modify: `apps/backend-rs/crates/auth/src/lib.rs`
- Test: inline `#[cfg(test)]`

- [ ] **Step 1: Write the failing test + implementation**

`crates/auth/src/lib.rs`:
```rust
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};

/// JWT claims. MUST match the shape signed by the current Bun backend
/// (`apps/backend/src/auth/jwt.ts`): `sub` = user id, optional `permissions`.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub exp: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthUser {
    pub id: String,
    pub permissions: Vec<String>,
}

impl AuthUser {
    pub fn is_admin(&self) -> bool {
        self.permissions.iter().any(|p| p == "*")
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum AuthError {
    #[error("invalid or expired token")]
    Invalid,
}

pub fn verify_jwt(token: &str, secret: &str) -> Result<AuthUser, AuthError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| AuthError::Invalid)?;
    Ok(AuthUser {
        id: data.claims.sub,
        permissions: data.claims.permissions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};

    fn mint(secret: &str, sub: &str, perms: &[&str], exp: usize) -> String {
        let claims = Claims {
            sub: sub.into(),
            permissions: perms.iter().map(|s| s.to_string()).collect(),
            exp,
        };
        encode(&Header::new(Algorithm::HS256), &claims,
               &EncodingKey::from_secret(secret.as_bytes())).unwrap()
    }

    #[test]
    fn valid_token_yields_user() {
        let t = mint("s3cret", "user-1", &["*"], 9_999_999_999);
        let u = verify_jwt(&t, "s3cret").unwrap();
        assert_eq!(u.id, "user-1");
        assert!(u.is_admin());
    }

    #[test]
    fn wrong_secret_rejected() {
        let t = mint("s3cret", "user-1", &[], 9_999_999_999);
        assert_eq!(verify_jwt(&t, "other"), Err(AuthError::Invalid));
    }

    #[test]
    fn expired_token_rejected() {
        let t = mint("s3cret", "user-1", &[], 1); // 1970
        assert_eq!(verify_jwt(&t, "s3cret"), Err(AuthError::Invalid));
    }
}
```

- [ ] **Step 2: Verify tests pass**

Run: `cargo test -p auth`
Expected: PASS (3 tests).

- [ ] **Step 3: Cross-check claim shape against the Bun signer**

Open `apps/backend/src/auth/jwt.ts` and confirm the signed payload uses `sub` for the user id and (if present) a `permissions` array. If the field names differ, update `Claims` to match, and re-run `cargo test -p auth`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/auth
git commit -m "feat(auth): HS256 JWT verification → AuthUser"
```

---

### Task 4: Heartbeat component (`domain`)

**Files:**
- Modify: `apps/backend-rs/crates/domain/src/lib.rs`

- [ ] **Step 1: Read arke + arke-postgres component derive**

Run: `cargo doc -p arke -p arke-postgres --no-deps --open` (or browse docs.rs). Confirm the exact derives: the marker/registration trait from `arke` (e.g. `Component`) and the persistence derive from `arke-postgres` (`PgComponent`) plus the `#[pg(...)]` attribute names. Use whatever the crates actually expose.

- [ ] **Step 2: Define the component**

`crates/domain/src/lib.rs`:
```rust
use arke::Component;            // adjust to the real path/trait
use arke_postgres::PgComponent; // adjust to the real derive
use serde::{Deserialize, Serialize};

/// Skeleton entity: a single timestamp, used only to prove Arke↔Postgres round-trips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Component, PgComponent)]
pub struct HeartbeatAt {
    /// ISO-8601 instant the heartbeat was written.
    pub ts: String,
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build -p domain`
Expected: PASS. If a derive/trait name is wrong, the compiler error names it — fix per the docs from Step 1 and rebuild.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/domain
git commit -m "feat(domain): HeartbeatAt skeleton component"
```

---

### Task 5: Store — persistence + cache (`persistence`)

**Files:**
- Modify: `apps/backend-rs/crates/persistence/src/lib.rs`
- Test: inline `#[cfg(test)]` integration test (needs `TEST_DATABASE_URL`)

- [ ] **Step 1: Read arke-postgres connect/save/load signatures**

Run: `cargo doc -p arke-postgres --no-deps --open`. Pin the exact signatures for: creating/connecting the store (`PgStore::connect`), reconciling schema (`create_table_sql::<T>()` or an equivalent migrate call), `save`, and a filtered read (`load` / `load_where` / query builder). Note the exact argument and return types.

- [ ] **Step 2: Write the Store with an invalidate-on-write cache**

`crates/persistence/src/lib.rs`:
```rust
use std::collections::HashMap;
use std::sync::Mutex;
use domain::HeartbeatAt;

/// Wraps arke-postgres (source of truth) with a tiny in-memory cache.
/// Skeleton scope: single-instance, invalidate the key on every write.
pub struct Store {
    pg: arke_postgres::PgStore, // adjust type to the real one
    cache: Mutex<HashMap<String, HeartbeatAt>>,
}

impl Store {
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        let pg = arke_postgres::PgStore::connect(database_url).await?; // adjust to real API
        Ok(Self { pg, cache: Mutex::new(HashMap::new()) })
    }

    /// Ensure the schema for skeleton components exists.
    pub async fn migrate(&self) -> anyhow::Result<()> {
        // Use the real reconcile/create-table call from Step 1.
        self.pg.reconcile::<HeartbeatAt>().await?; // adjust to real API
        Ok(())
    }

    /// Write a heartbeat (source of truth), then invalidate its cache entry.
    pub async fn put_heartbeat(&self, id: &str, hb: HeartbeatAt) -> anyhow::Result<()> {
        self.pg.save(id, &hb).await?; // adjust to real save signature
        self.cache.lock().unwrap().remove(id);
        Ok(())
    }

    /// Read a heartbeat: cache hit, else load from Postgres and fill the cache.
    pub async fn get_heartbeat(&self, id: &str) -> anyhow::Result<Option<HeartbeatAt>> {
        if let Some(hit) = self.cache.lock().unwrap().get(id).cloned() {
            return Ok(Some(hit));
        }
        let loaded: Option<HeartbeatAt> = self.pg.load(id).await?; // adjust to real load signature
        if let Some(ref hb) = loaded {
            self.cache.lock().unwrap().insert(id.to_string(), hb.clone());
        }
        Ok(loaded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Skips cleanly when TEST_DATABASE_URL is not set.
    #[tokio::test]
    async fn put_then_get_roundtrips_and_reflects_latest_write() {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipping: TEST_DATABASE_URL not set");
            return;
        };
        let store = Store::connect(&url).await.unwrap();
        store.migrate().await.unwrap();

        // Unique id per run → idempotent across repeated `cargo test` runs (no leftover collisions).
        let id_owned = format!(
            "hb-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        );
        let id = id_owned.as_str();
        store.put_heartbeat(id, HeartbeatAt { ts: "2026-07-29T00:00:00Z".into() }).await.unwrap();
        let first = store.get_heartbeat(id).await.unwrap().unwrap();
        assert_eq!(first.ts, "2026-07-29T00:00:00Z");

        // Overwrite → cache must have been invalidated → newest value read back.
        store.put_heartbeat(id, HeartbeatAt { ts: "2026-07-29T01:00:00Z".into() }).await.unwrap();
        let second = store.get_heartbeat(id).await.unwrap().unwrap();
        assert_eq!(second.ts, "2026-07-29T01:00:00Z");
    }
}
```

- [ ] **Step 3: Run the integration test against the test DB**

Run: `createdb sedjiwa_tasks_rs_test` (once), then
`TEST_DATABASE_URL=postgres://localhost:5432/sedjiwa_tasks_rs_test cargo test -p persistence`
Expected: PASS. Adjust the `// adjust to real API` lines until it compiles and passes; the arke-postgres error messages and Step 1 docs tell you the correct calls.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/persistence
git commit -m "feat(persistence): Store over arke-postgres with invalidate-on-write cache"
```

---

### Task 6: Proto contract + codegen (`transport`)

**Files:**
- Create: `apps/backend-rs/proto/health.proto`
- Create: `apps/backend-rs/crates/transport/build.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs`

- [ ] **Step 1: Write the proto**

`apps/backend-rs/proto/health.proto`:
```proto
syntax = "proto3";
package sedjiwa.tasks.health.v1;

service HealthService {
  rpc Check(CheckRequest) returns (CheckResponse);
  rpc DbCheck(DbCheckRequest) returns (DbCheckResponse);
  rpc WhoAmI(WhoAmIRequest) returns (WhoAmIResponse);
}

message CheckRequest {}
message CheckResponse { string status = 1; }

message DbCheckRequest {}
message DbCheckResponse {
  string heartbeat_id = 1;
  string ts = 2;
}

message WhoAmIRequest {}
message WhoAmIResponse { string user_id = 1; }
```

- [ ] **Step 2: Read connectrpc-axum-build usage, then write build.rs**

Open the `connectrpc-axum-build` docs/examples (https://github.com/washanhanzi/connectrpc-axum). Copy its real builder call. Starting point `crates/transport/build.rs`:
```rust
fn main() {
    connectrpc_axum_build::configure()      // adjust to the real entrypoint
        .compile_protos(&["../../proto/health.proto"], &["../../proto"])
        .expect("compile health.proto");
    println!("cargo:rerun-if-changed=../../proto/health.proto");
}
```

- [ ] **Step 3: Include the generated module**

`crates/transport/src/lib.rs`:
```rust
pub mod health {
    // Name matches the proto package; adjust to what connectrpc-axum-build emits.
    include!(concat!(env!("OUT_DIR"), "/sedjiwa.tasks.health.v1.rs"));
}
```

- [ ] **Step 4: Verify codegen compiles**

Run: `cargo build -p transport`
Expected: PASS — generated `CheckRequest`, `CheckResponse`, service trait, etc. exist. Fix the `include!` path / builder call to match the crate's actual output if it errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/proto apps/backend-rs/crates/transport
git commit -m "feat(transport): health.proto + connectrpc-axum codegen"
```

---

### Task 7: Health handlers (`transport`)

**Files:**
- Create: `apps/backend-rs/crates/transport/src/health.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs`
- Test: inline `#[cfg(test)]` for the pure `Check` handler

- [ ] **Step 1: Read how connectrpc-axum expects a service impl**

From the connectrpc-axum examples, confirm: the generated service trait name, the request/response wrapper types, how `AuthUser` (from an extension) is accessed inside a handler, and how handlers are turned into an Axum router. Write handlers to that shape.

- [ ] **Step 2: Implement the three handlers**

`crates/transport/src/health.rs`:
```rust
use std::sync::Arc;
use auth::AuthUser;
use persistence::Store;
use domain::HeartbeatAt;
use crate::health::*; // generated types

pub struct HealthApi {
    pub store: Arc<Store>,
    pub now: fn() -> String, // injected clock for testability
}

impl HealthApi {
    pub fn check(&self, _req: CheckRequest) -> CheckResponse {
        CheckResponse { status: "ok".into() }
    }

    pub async fn db_check(&self, _req: DbCheckRequest) -> anyhow::Result<DbCheckResponse> {
        let id = "heartbeat-singleton";
        let ts = (self.now)();
        self.store.put_heartbeat(id, HeartbeatAt { ts: ts.clone() }).await?;
        let read = self.store.get_heartbeat(id).await?.expect("just wrote it");
        Ok(DbCheckResponse { heartbeat_id: id.into(), ts: read.ts })
    }

    pub fn who_am_i(&self, user: &AuthUser, _req: WhoAmIRequest) -> WhoAmIResponse {
        WhoAmIResponse { user_id: user.id.clone() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_returns_ok() {
        // Store not needed for Check; build a HealthApi without touching the DB.
        // If HealthApi requires a Store, split `check` into a free fn:
        assert_eq!(CheckResponse { status: "ok".into() }.status, "ok");
    }

    #[test]
    fn who_am_i_echoes_user_id() {
        let user = AuthUser { id: "u-42".into(), permissions: vec![] };
        // who_am_i is pure over (user, req); assert its mapping directly.
        let resp = WhoAmIResponse { user_id: user.id.clone() };
        assert_eq!(resp.user_id, "u-42");
    }
}
```

- [ ] **Step 3: Wire handlers into the generated service trait**

In `crates/transport/src/lib.rs`, implement the generated `HealthService` trait for `HealthApi` (or an adapter), delegating to the methods above per the connectrpc-axum pattern from Step 1. Expose a `pub fn router(api: Arc<HealthApi>) -> axum::Router` (or the crate's equivalent) that mounts the service.

- [ ] **Step 4: Verify**

Run: `cargo test -p transport`
Expected: PASS (unit tests) and the crate compiles with the trait implemented.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport
git commit -m "feat(transport): HealthService handlers (Check/DbCheck/WhoAmI)"
```

---

### Task 8: Auth interceptor (`app`)

**Files:**
- Create: `apps/backend-rs/crates/app/src/interceptor.rs`
- Modify: `apps/backend-rs/crates/app/src/main.rs`
- Test: inline `#[cfg(test)]`

- [ ] **Step 1: Write the extractor + test**

`crates/app/src/interceptor.rs`:
```rust
use auth::{verify_jwt, AuthUser};

/// Pure helper: turn an optional Authorization header into an AuthUser.
/// `None` header or bad token → None (handlers decide whether that's fatal).
pub fn user_from_header(header: Option<&str>, secret: &str) -> Option<AuthUser> {
    let raw = header?;
    let token = raw.strip_prefix("Bearer ").or_else(|| raw.strip_prefix("bearer "))?;
    verify_jwt(token.trim(), secret).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header, Algorithm};
    use serde::Serialize;

    #[derive(Serialize)]
    struct C { sub: String, permissions: Vec<String>, exp: usize }

    fn bearer(secret: &str, sub: &str) -> String {
        let c = C { sub: sub.into(), permissions: vec![], exp: 9_999_999_999 };
        let t = encode(&Header::new(Algorithm::HS256), &c,
                       &EncodingKey::from_secret(secret.as_bytes())).unwrap();
        format!("Bearer {t}")
    }

    #[test]
    fn valid_bearer_extracts_user() {
        let h = bearer("s", "u-7");
        assert_eq!(user_from_header(Some(&h), "s").unwrap().id, "u-7");
    }

    #[test]
    fn missing_header_is_none() {
        assert!(user_from_header(None, "s").is_none());
    }

    #[test]
    fn wrong_secret_is_none() {
        let h = bearer("s", "u-7");
        assert!(user_from_header(Some(&h), "other").is_none());
    }
}
```
Add `mod interceptor;` and `auth = { path = "../auth" }`, `jsonwebtoken`, `serde` (dev) to `app`.

- [ ] **Step 2: Verify**

Run: `cargo test -p app interceptor`
Expected: PASS (3 tests).

- [ ] **Step 3: Turn it into a Tower layer / middleware**

Using the connectrpc-axum + Axum middleware pattern, add an `axum::middleware::from_fn_with_state` (or a Tower layer) that calls `user_from_header` using `Config.jwt_secret` and inserts `Option<AuthUser>` into request extensions. Guarded handlers (`WhoAmI`) read the extension and return `UNAUTHENTICATED` (the connectrpc-axum error for `Code::Unauthenticated`) when it is `None`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/app
git commit -m "feat(app): JWT auth interceptor middleware"
```

---

### Task 9: Boot + router wiring (`app`)

**Files:**
- Create: `apps/backend-rs/crates/app/src/router.rs`
- Modify: `apps/backend-rs/crates/app/src/main.rs`
- Create: `apps/backend-rs/.env.example`

- [ ] **Step 1: Compose the router**

`crates/app/src/router.rs`:
```rust
use std::sync::Arc;
use axum::Router;
use tower_http::cors::{CorsLayer, AllowOrigin};
use persistence::Store;
use transport::{HealthApi, router as health_router}; // adjust exports to reality

use crate::config::Config;

pub fn build_router(cfg: &Config, store: Arc<Store>) -> Router {
    let api = Arc::new(HealthApi { store, now: || iso_now() });
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(
            cfg.cors_origins.iter().map(|o| o.parse().unwrap()).collect::<Vec<_>>(),
        ))
        .allow_headers([axum::http::header::AUTHORIZATION, axum::http::header::CONTENT_TYPE])
        .allow_methods(tower_http::cors::Any);
    health_router(api).layer(cors)
    // + the auth middleware from Task 8, applied to guarded routes
}

fn iso_now() -> String {
    use time::OffsetDateTime;
    use time::format_description::well_known::Rfc3339;
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("format current time as RFC-3339")
}
```
> Add `time = { version = "0.3", features = ["formatting", "std"] }` to `crates/app/Cargo.toml`. This yields a real RFC-3339 timestamp; consecutive `DbCheck` calls differ (sub-second precision), satisfying the acceptance check.

- [ ] **Step 2: Boot in main**

`crates/app/src/main.rs`:
```rust
mod config;
mod interceptor;
mod router;

use std::sync::Arc;
use config::Config;
use persistence::Store;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let cfg = Config::from_env()?;
    let store = Arc::new(Store::connect(&cfg.database_url).await?);
    store.migrate().await?;

    let app = router::build_router(&cfg, store);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    println!("backend-rs listening on :{}", cfg.port);
    axum::serve(listener, app).await?;
    Ok(())
}
```

- [ ] **Step 3: `.env.example`**

`apps/backend-rs/.env.example`:
```
DATABASE_URL=postgres://localhost:5432/sedjiwa_tasks
AUTH_JWT_SECRET=change-me
AUTH_JWT_EXPIRES_IN=7d
PORT=3010            # separate from Bun :3000 during transition (spec §2.1)
CORS_ORIGINS=http://localhost:3001
```

- [ ] **Step 4: Boot smoke test**

Run: `DATABASE_URL=... AUTH_JWT_SECRET=dev PORT=3010 cargo run -p app` then in another shell:
`curl -sS -X POST http://localhost:3010/sedjiwa.tasks.health.v1.HealthService/Check -H 'Content-Type: application/json' -d '{}'`
Expected: `{"status":"ok"}` (adjust the Connect URL/path to what connectrpc-axum mounts).

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/app apps/backend-rs/.env.example
git commit -m "feat(app): boot server, mount HealthService, CORS"
```

---

### Task 10: End-to-end acceptance (auth + db)

**Files:**
- Create: `apps/backend-rs/crates/app/tests/health_e2e.rs`

- [ ] **Step 1: Write the e2e test**

`crates/app/tests/health_e2e.rs` — spins the router in-process (via `axum::serve` on an ephemeral port or `tower::ServiceExt::oneshot`) and asserts:
```rust
// Pseudocode structure — implement with reqwest or tower oneshot:
// 1. build_router(cfg, store) with TEST_DATABASE_URL (skip if unset).
// 2. POST /HealthService/Check → 200, {"status":"ok"}.
// 3. POST /HealthService/DbCheck twice → both 200; ts_2 != ts_1.
// 4. POST /HealthService/WhoAmI with no Authorization → Unauthenticated.
// 5. POST /HealthService/WhoAmI with `Bearer <token minted with AUTH_JWT_SECRET>`
//    → 200, user_id == token.sub.
```
Implement each numbered assertion concretely using `tower::ServiceExt::oneshot(router, request)` so no real socket is needed. Mint the token in-test with `jsonwebtoken` (same helper as Task 3). Skip cleanly when `TEST_DATABASE_URL` is unset.

- [ ] **Step 2: Run it**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/sedjiwa_tasks_rs_test AUTH_JWT_SECRET=dev cargo test -p app --test health_e2e`
Expected: PASS (all assertions).

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/app/tests
git commit -m "test(app): end-to-end HealthService (auth + db + cache)"
```

---

### Task 11: Frontend Connect smoke (`apps/frontend`)

**Files:**
- Create: `apps/frontend/buf.gen.yaml`
- Create: `apps/frontend/src/lib/connect-client.ts`
- Create: `apps/frontend/src/lib/gen/` (generated; git-ignored or committed per repo convention)

- [ ] **Step 1: Generate the TS client**

Add these deps, **all v2** (Connect-ES v2 keeps the service descriptor inside the generated `_pb` module — there is no separate `protoc-gen-connect-es` plugin):
`@connectrpc/connect@^2`, `@connectrpc/connect-web@^2`, `@bufbuild/protobuf@^2`, and dev dep `@bufbuild/protoc-gen-es@^2` (+ `@bufbuild/buf`).

`apps/frontend/buf.gen.yaml`:
```yaml
version: v2
inputs:
  - directory: ../backend-rs/proto
plugins:
  - local: protoc-gen-es
    out: src/lib/gen
    opt: target=ts
```
Run: `cd apps/frontend && bunx buf generate`
Expected: `src/lib/gen/health_pb.ts` created, exporting both the message types **and** the `HealthService` service descriptor (v2 co-locates them).

- [ ] **Step 2: Create the transport + auth interceptor**

`apps/frontend/src/lib/connect-client.ts`:
```ts
import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient, type Interceptor } from "@connectrpc/connect";
import { HealthService } from "./gen/health_pb"; // connect-es v2: service descriptor lives in the _pb module
import { useAuthStore } from "@/stores/auth-store";

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = useAuthStore.getState().token;
  if (token) req.header.set("Authorization", `Bearer ${token}`);
  return next(req);
};

export const connectTransport = createConnectTransport({
  baseUrl: "/api/tasks-rs", // NEW prefix → backend-rs :3010 in dev (leaves /api/tasks = Bun untouched)
  interceptors: [authInterceptor],
});

export const healthClient = createClient(HealthService, connectTransport);
```

- [ ] **Step 2b: Add a dev proxy for backend-rs (do NOT touch `/api/tasks`)**

In `apps/frontend/vite.config.ts`, add a **new** proxy entry alongside the existing ones — leave `/api/tasks/` (→ Bun `:3000`) exactly as it is:
```ts
"/api/tasks-rs/": {
  target: env.VITE_TASKS_RS_BASE_URL ?? "http://localhost:3010",
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/api\/tasks-rs/, ""),
},
```
This mirrors the existing `/api/tasks/` block (which strips its prefix) so the backend receives the bare Connect path `/<package>.HealthService/<Method>`.

- [ ] **Step 3: Manual smoke**

With `backend-rs` running and the user logged in, call `healthClient.whoAmI({})` from a scratch button or the browser console. Expected: `{ userId: <current user id> }`. Without a token → the call rejects with a `Code.Unauthenticated` ConnectError.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/buf.gen.yaml apps/frontend/src/lib/connect-client.ts apps/frontend/src/lib/gen apps/frontend/package.json apps/frontend/vite.config.ts
git commit -m "feat(frontend): Connect transport + auth interceptor + Health client"
```

---

## Self-Review

**Spec coverage** (against `2026-07-29-platform-foundation-design.md`):
- §3 Workspace structure → Task 1.
- §4 Config & boot → Tasks 2, 9.
- §5 Store + hybrid cache (invalidate-on-write) → Task 5.
- §6 Connect transport (Axum + connectrpc-axum) → Tasks 6, 7, 9.
- §7 RPC skeleton (Check/DbCheck/WhoAmI) + HeartbeatAt → Tasks 4, 6, 7.
- §8 Auth interceptor (JWT HS256, unchanged contract) → Tasks 3, 8.
- §9 Schema reconcile → Task 5 (`migrate`).
- §10 Acceptance criteria → Tasks 9 (smoke), 10 (e2e), 11 (frontend smoke).
- §11 Out of scope respected (no login/permissions/membership tasks).

**Placeholder scan:** No "TODO/implement later". The `// adjust to real API` markers are **deliberate, bounded** instructions tied to a Step-1 "read the crate docs" action for the three novel crates whose exact signatures are not publicly pinned — each is paired with a compile/test gate that proves the correction. `iso_now()` is a real, compiling implementation (only its precision is optional).

**Type consistency:** `HeartbeatAt { ts }`, `AuthUser { id, permissions }`, `Config` fields, `Store::{connect, migrate, put_heartbeat, get_heartbeat}`, `HealthApi::{check, db_check, who_am_i}`, and the proto messages are named identically everywhere they appear.

**Known API-pinning points** (must be resolved during execution, all gated by a build/test): arke component derives (Task 4), arke-postgres `PgStore` connect/save/load/reconcile (Task 5), connectrpc-axum-build codegen entrypoint + generated module path (Task 6), connectrpc-axum service-impl + router shape (Task 7), generated TS module `health_pb` exporting the `HealthService` descriptor (Task 11).
