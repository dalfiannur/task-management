# MCP Server (PAT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal mengekspos MCP server ber-PAT di `POST /api/tasks-rs/mcp` sehingga tiap user bisa menyambungkan AI client miliknya sendiri ke akun portalnya, dengan 12 tool untuk task, project, pencarian, dan komentar.

**Architecture:** Crate baru `crates/mcp` di workspace `backend-rs` dipasang pada axum router yang sama dengan Connect service. Logika bisnis yang hari ini terkubur di dalam handler axum diekstrak menjadi "core fn" (`transport::api::*`) sehingga MCP dan UI memakai satu jalur yang sama — termasuk member-gating, activity record, notifikasi, dan search index. Autentikasi PAT dikurung khusus di endpoint MCP; `auth_layer` global tetap JWT-only.

**Tech Stack:** Rust (axum 0.8, connectrpc-axum 0.2, prost, serde_json, sha2, rand), Arke ECS + arke-postgres, PostgreSQL; frontend React 19 + TanStack Router/Query + connect-query + Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-09-02-mcp-server-design.md`

**Konvensi bahasa:** komentar di dalam blok kode (```rust dan ```typescript) ditulis dalam bahasa Inggris, mengikuti konvensi source code yang sudah ada — teks penjelasan rencana ini sendiri tetap bahasa Indonesia.

---

## File Structure

**Backend — dibuat:**

| File | Tanggung jawab |
|---|---|
| `apps/backend-rs/proto/tokens.proto` | Kontrak `AccessTokenService` (Create/List/Revoke) |
| `apps/backend-rs/crates/domain/src/token.rs` | Komponen ECS PAT + aturan murni (generate, hash, preview, expiry) |
| `apps/backend-rs/crates/transport/src/tokens/mod.rs` | Barrel + helper modul token |
| `apps/backend-rs/crates/transport/src/tokens/record.rs` | Baca token dari store (by hash, by owner) |
| `apps/backend-rs/crates/transport/src/tokens/token_service.rs` | Handler `AccessTokenService` + `token_router` |
| `apps/backend-rs/crates/transport/src/api.rs` | Permukaan core fn in-process yang dipakai crate `mcp` |
| `apps/backend-rs/crates/mcp/Cargo.toml` | Manifest crate MCP |
| `apps/backend-rs/crates/mcp/src/lib.rs` | `mcp_router` + state |
| `apps/backend-rs/crates/mcp/src/protocol.rs` | Envelope JSON-RPC 2.0 + dispatch `initialize`/`ping`/`tools/*` |
| `apps/backend-rs/crates/mcp/src/pat.rs` | Verifikasi PAT → `AuthUser`, update `last_used_at` ter-throttle |
| `apps/backend-rs/crates/mcp/src/tools/mod.rs` | Registry tool + tipe `Tool`/`ToolError` + mapping error |
| `apps/backend-rs/crates/mcp/src/tools/tasks.rs` | 5 tool task |
| `apps/backend-rs/crates/mcp/src/tools/projects.rs` | 3 tool project/module |
| `apps/backend-rs/crates/mcp/src/tools/discovery.rs` | `search`, `my_tasks` |
| `apps/backend-rs/crates/mcp/src/tools/comments.rs` | `list_comments`, `add_comment` |
| `apps/backend-rs/crates/transport/tests/tokens_flow.rs` | Uji end-to-end RPC token |
| `apps/backend-rs/crates/mcp/tests/mcp_flow.rs` | Uji end-to-end endpoint MCP |

**Backend — diubah:**

| File | Perubahan |
|---|---|
| `apps/backend-rs/Cargo.toml` | Tambah `sha2`, `rand` ke workspace deps |
| `apps/backend-rs/crates/domain/Cargo.toml` | Tambah `sha2`, `rand` |
| `apps/backend-rs/crates/domain/src/lib.rs` | `pub mod token;` + registrasi 4 komponen |
| `apps/backend-rs/crates/transport/build.rs` | Kompilasi `tokens.proto` |
| `apps/backend-rs/crates/transport/src/lib.rs` | `mod tokens; pub mod api;` + `pub use tokens::token_router` |
| `apps/backend-rs/crates/transport/src/work/mod.rs` | `pub(crate) mod task_service;` `pub(crate) mod module_service;` |
| `apps/backend-rs/crates/transport/src/work/task_service.rs` | Ekstrak 5 core fn |
| `apps/backend-rs/crates/transport/src/work/module_service.rs` | Ekstrak `list_modules_core` |
| `apps/backend-rs/crates/transport/src/projects/*` | Ekstrak `list_projects_core`, `get_project_core` |
| `apps/backend-rs/crates/transport/src/comments/*` | Ekstrak `list_comments_core`, `create_comment_core` |
| `apps/backend-rs/crates/transport/src/search/*` | Ekstrak `search_core` |
| `apps/backend-rs/crates/transport/src/dashboard/*` | Ekstrak `my_tasks_core` |
| `apps/backend-rs/crates/app/Cargo.toml` | Tambah dep `mcp` |
| `apps/backend-rs/crates/app/src/router.rs` | Merge `token_router` + nest `mcp_router` |

**Frontend — dibuat:** `src/features/tokens/{types.ts,index.ts,api/mappers.ts,api/hooks.ts,components/token-table.tsx,components/create-token-dialog.tsx,components/connect-panel.tsx}`, `src/routes/_authed/settings/tokens.tsx`.
**Frontend — diubah:** `src/features/auth/components/app-shell.tsx` (entri nav), `src/lib/gen/tokens_pb.ts` (hasil `buf generate`).

---

# Phase 1 — Fondasi PAT

## Task 1: Komponen & aturan token di `domain`

**Files:**
- Create: `apps/backend-rs/crates/domain/src/token.rs`
- Modify: `apps/backend-rs/Cargo.toml`, `apps/backend-rs/crates/domain/Cargo.toml`, `apps/backend-rs/crates/domain/src/lib.rs`

Semua perintah di task ini dijalankan dari `apps/backend-rs/`.

- [ ] **Step 1: Tambah dependency**

Di `apps/backend-rs/Cargo.toml`, dalam `[workspace.dependencies]`, tambahkan setelah baris `argon2 = ...`:

```toml
sha2 = "0.10"
rand = "0.8"
```

Di `apps/backend-rs/crates/domain/Cargo.toml`, dalam `[dependencies]`, tambahkan:

```toml
sha2 = { workspace = true }
rand = { workspace = true }
time = { workspace = true }
```

- [ ] **Step 2: Tulis test yang gagal**

Buat `apps/backend-rs/crates/domain/src/token.rs` berisi **hanya** blok test ini dulu:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_has_prefix_and_fixed_length() {
        let t = generate_token();
        assert!(t.starts_with(TOKEN_PREFIX));
        assert_eq!(t.len(), TOKEN_PREFIX.len() + 64);
        assert!(looks_like_token(&t));
    }

    #[test]
    fn two_tokens_differ() {
        assert_ne!(generate_token(), generate_token());
    }

    #[test]
    fn hash_is_stable_and_not_the_plaintext() {
        let t = generate_token();
        let h = hash_token(&t);
        assert_eq!(h, hash_token(&t));
        assert_eq!(h.len(), 64);
        assert!(!h.contains(&t));
    }

    #[test]
    fn preview_is_last_four_chars() {
        assert_eq!(preview_of("sjw_pat_00ff1a2b"), "1a2b");
        assert_eq!(preview_of("ab"), "ab"); // shorter than 4 → returned as-is
    }

    #[test]
    fn garbage_is_not_a_token() {
        assert!(!looks_like_token("hello"));
        assert!(!looks_like_token(&"sjw_pat_".repeat(9)));
        // Right length, but has a non-hex character.
        let bad = format!("{TOKEN_PREFIX}{}", "z".repeat(64));
        assert!(!looks_like_token(&bad));
    }

    #[test]
    fn expiry_compares_lexicographically() {
        assert!(!is_expired(None, "2026-09-02T00:00:00Z"));
        assert!(is_expired(
            Some("2026-09-01T00:00:00Z"),
            "2026-09-02T00:00:00Z"
        ));
        assert!(!is_expired(
            Some("2026-09-03T00:00:00Z"),
            "2026-09-02T00:00:00Z"
        ));
    }
}
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `cargo test -p domain token::`
Expected: FAIL kompilasi — `cannot find function generate_token in this scope`.

- [ ] **Step 4: Tulis implementasinya**

Sisipkan di atas blok `#[cfg(test)]` pada `crates/domain/src/token.rs`:

```rust
//! Personal access token (PAT) for the MCP endpoint: ECS components + pure rules.
//!
//! Design note: the secret is stored as a **SHA-256 digest, not Argon2**. A PAT
//! carries 256 bits of entropy so it isn't brute-force-able like a human
//! password, while Argon2 would add ~50-100 ms to *every* MCP tool call.
//! Password hashing stays on `user::UserPassword`.

use arke_postgres::PgComponent;

/// Prefix of every token we issue, so a leaked string is easy to grep for.
pub const TOKEN_PREFIX: &str = "sjw_pat_";

/// Opaque secret, stored only as a digest. `preview` is the plaintext's last 4
/// characters — the only part the UI is ever allowed to show again.
#[derive(PgComponent, Debug, Clone)]
pub struct TokenSecret {
    #[pg(index, unique)]
    pub hash: String,
    pub preview: String,
}

/// The token's owner. Indexed because every list read filters by it.
#[derive(PgComponent, Debug, Clone)]
pub struct TokenOwner {
    #[pg(index)]
    pub user_id: String,
}

#[derive(PgComponent, Debug, Clone)]
pub struct TokenInfo {
    pub name: String,
    pub created_at: String,
    /// RFC3339. `None` = never expires (`expires_in_days = 0`).
    pub expires_at: Option<String>,
}

#[derive(PgComponent, Debug, Clone)]
pub struct TokenUsage {
    pub last_used_at: Option<String>,
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Issue a new token: `sjw_pat_` + 32 random bytes in hex.
pub fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{TOKEN_PREFIX}{}", to_hex(&bytes))
}

/// The digest that gets stored. Deterministic — a token lookup is a lookup by hash.
pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    to_hex(&Sha256::digest(token.as_bytes()))
}

/// Last 4 characters — the only plaintext remnant ever allowed to be seen again.
pub fn preview_of(token: &str) -> String {
    let n = token.chars().count();
    token.chars().skip(n.saturating_sub(4)).collect()
}

/// Shape we could never have issued → reject before ever touching the database.
///
/// This is also what makes `hash_token` safe to use in building a SQL
/// predicate: its value is always a 64-character hex digest from our own
/// computation, never raw text from the user.
pub fn looks_like_token(s: &str) -> bool {
    s.len() == TOKEN_PREFIX.len() + 64
        && s.starts_with(TOKEN_PREFIX)
        && s[TOKEN_PREFIX.len()..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Past `expires_at` already? `None` = never expires.
///
/// Compares RFC3339 UTC strings lexicographically — that lexical order matches
/// time order as long as both sides are formatted by transport's `now_iso()`.
/// `task::dates_ok` uses the same pattern.
/// The clock every token timestamp is written with.
///
/// Pinned to whole seconds, and it lives here rather than in each caller because
/// [`is_expired`] is what depends on the pinning: `time`'s RFC3339 formatter omits
/// the fractional part when nanoseconds are zero and truncates trailing zeros
/// otherwise, so mixed precision can invert a comparison inside a single second.
/// Three copies of that reasoning are three chances for one to drift.
pub fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    let now = time::OffsetDateTime::now_utc();
    now.replace_nanosecond(0)
        .unwrap_or(now)
        .format(&Rfc3339)
        .unwrap_or_default()
}

pub fn is_expired(expires_at: Option<&str>, now: &str) -> bool {
    match expires_at {
        None => false,
        Some(e) => e <= now,
    }
}
```

- [ ] **Step 5: Daftarkan modul dan komponennya**

Di `crates/domain/src/lib.rs`, tambahkan `pub mod token;` pada daftar modul (urut alfabet, setelah `pub mod task;`), lalu di ujung `register_all` — setelah blok `// Activity.` — tambahkan:

```rust
    // Access tokens (PAT for MCP).
    pg.register::<token::TokenSecret>();
    pg.register::<token::TokenOwner>();
    pg.register::<token::TokenInfo>();
    pg.register::<token::TokenUsage>();
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `cargo test -p domain token::`
Expected: PASS, 6 test.

- [ ] **Step 7: Commit**

```bash
git add apps/backend-rs/Cargo.toml apps/backend-rs/Cargo.lock \
        apps/backend-rs/crates/domain/Cargo.toml \
        apps/backend-rs/crates/domain/src/token.rs \
        apps/backend-rs/crates/domain/src/lib.rs
git commit -m "feat(domain): add personal access token components and rules"
```

---

## Task 2: Kontrak proto `AccessTokenService`

**Files:**
- Create: `apps/backend-rs/proto/tokens.proto`
- Modify: `apps/backend-rs/crates/transport/build.rs`

- [ ] **Step 1: Tulis protonya**

Buat `apps/backend-rs/proto/tokens.proto`:

```proto
syntax = "proto3";
package sedjiwa.tasks.token.v1;

// Personal access token for the MCP endpoint. Every RPC is self-scoped: the
// owner is always taken from the caller's JWT, so even an admin cannot read
// or revoke someone else's token. The plaintext token exists only once, in
// the CreateToken response; `AccessToken` deliberately doesn't carry it, so
// no RPC here can ever show it again.

service AccessTokenService {
  rpc CreateToken(CreateTokenRequest) returns (CreateTokenResponse);
  rpc ListTokens(ListTokensRequest) returns (ListTokensResponse);
  rpc RevokeToken(RevokeTokenRequest) returns (RevokeTokenResponse);
}

// Token metadata. The plaintext never appears here.
message AccessToken {
  string id = 1;
  string name = 2;
  string preview = 3; // last 4 characters, to tell rows apart in the UI
  string created_at = 4;
  optional string expires_at = 5;   // absent = never expires
  optional string last_used_at = 6; // absent = never used
  bool expired = 7;                 // computed by the server against the current time
}

message CreateTokenRequest {
  string name = 1;
  uint32 expires_in_days = 2; // 0 = never expires
}
// `token` exists only in this response and can never be read again.
message CreateTokenResponse {
  string token = 1;
  AccessToken access_token = 2;
}

message ListTokensRequest {}
message ListTokensResponse {
  repeated AccessToken tokens = 1;
}

message RevokeTokenRequest {
  string id = 1;
}
message RevokeTokenResponse {
  bool ok = 1;
}
```

- [ ] **Step 2: Daftarkan di build.rs**

Di `apps/backend-rs/crates/transport/build.rs`, tambahkan `"../../proto/tokens.proto",` di akhir array pertama (setelah `export.proto`), dan di bawahnya tambahkan:

```rust
    println!("cargo:rerun-if-changed=../../proto/tokens.proto");
```

- [ ] **Step 3: Pastikan proto terkompilasi**

Run: `cargo build -p transport`
Expected: sukses. Bila gagal dengan `File not found`, periksa jalur relatifnya dari direktori crate `transport`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/proto/tokens.proto apps/backend-rs/crates/transport/build.rs
git commit -m "feat(proto): add AccessTokenService contract"
```

---

## Task 3: RPC manajemen token

**Files:**
- Create: `apps/backend-rs/crates/transport/src/tokens/mod.rs`, `.../tokens/record.rs`, `.../tokens/token_service.rs`, `apps/backend-rs/crates/transport/tests/tokens_flow.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs`, `apps/backend-rs/crates/app/src/router.rs`

- [ ] **Step 1: Tulis uji alur yang gagal**

Buat `apps/backend-rs/crates/transport/tests/tokens_flow.rs`. Pola setup-nya menyalin `comment_flow.rs` — dilewati diam-diam bila `DATABASE_URL` tidak diset, dan memakai id unik supaya rerun tetap terisolasi:

```rust
//! End-to-end AccessTokenService through the real Connect router + Postgres.
//! Skipped unless `DATABASE_URL` is set. Ids are unique so reruns stay isolated.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const TOKENS: &str = "/sedjiwa.tasks.token.v1.AccessTokenService";

async fn auth_mw(mut req: Request, next: Next) -> Response {
    if let Some(tok) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(u) = verify_jwt(tok.trim(), SECRET) {
            req.extensions_mut().insert(u);
        }
    }
    next.run(req).await
}

async fn setup() -> Option<(Router, Arc<Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::token_router(store.clone()).layer(from_fn(auth_mw));
    Some((router, store))
}

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &[], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, jwt: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = jwt {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn create_list_revoke_round_trip() {
    let Some((router, _store)) = setup().await else { return };
    let user = format!("u-{}", uniq());
    let jwt = token(&user);

    let (st, created) = call(
        &router,
        &format!("{TOKENS}/CreateToken"),
        Some(&jwt),
        json!({ "name": "laptop", "expiresInDays": 0 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{created:?}");
    let plaintext = created["token"].as_str().unwrap().to_string();
    assert!(plaintext.starts_with("sjw_pat_"));
    assert_eq!(created["accessToken"]["name"], "laptop");
    assert_eq!(created["accessToken"]["preview"], plaintext[plaintext.len() - 4..]);
    assert!(created["accessToken"]["expiresAt"].is_null());
    let id = created["accessToken"]["id"].as_str().unwrap().to_string();

    let (st, listed) = call(&router, &format!("{TOKENS}/ListTokens"), Some(&jwt), json!({})).await;
    assert_eq!(st, StatusCode::OK);
    let rows = listed["tokens"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    // The plaintext never appears again after creation.
    assert!(rows[0].get("token").is_none());

    let (st, revoked) = call(
        &router,
        &format!("{TOKENS}/RevokeToken"),
        Some(&jwt),
        json!({ "id": id }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{revoked:?}");

    let (_, after) = call(&router, &format!("{TOKENS}/ListTokens"), Some(&jwt), json!({})).await;
    // proto3 JSON omits a repeated field entirely when it's empty, rather than
    // sending `[]`, so "no key" and "empty list" are the same thing here.
    assert!(after["tokens"].as_array().is_none_or(|a| a.is_empty()));
}

#[tokio::test]
async fn tokens_are_isolated_between_users() {
    let Some((router, _store)) = setup().await else { return };
    let owner = format!("u-{}", uniq());
    let other = format!("u-{}", uniq());

    let (_, created) = call(
        &router,
        &format!("{TOKENS}/CreateToken"),
        Some(&token(&owner)),
        json!({ "name": "mine", "expiresInDays": 30 }),
    )
    .await;
    let id = created["accessToken"]["id"].as_str().unwrap().to_string();
    assert!(created["accessToken"]["expiresAt"].is_string());

    // The other user doesn't see it…
    let (_, listed) = call(&router, &format!("{TOKENS}/ListTokens"), Some(&token(&other)), json!({})).await;
    assert!(listed["tokens"]
        .as_array()
        .is_none_or(|a| a.iter().all(|t| t["id"] != id.as_str())));

    // …and can't revoke it.
    let (st, _) = call(
        &router,
        &format!("{TOKENS}/RevokeToken"),
        Some(&token(&other)),
        json!({ "id": id }),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn anonymous_is_refused() {
    let Some((router, _store)) = setup().await else { return };
    let (st, _) = call(&router, &format!("{TOKENS}/ListTokens"), None, json!({})).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn empty_name_is_rejected() {
    let Some((router, _store)) = setup().await else { return };
    let jwt = token(&format!("u-{}", uniq()));
    let (st, _) = call(
        &router,
        &format!("{TOKENS}/CreateToken"),
        Some(&jwt),
        json!({ "name": "", "expiresInDays": 0 }),
    )
    .await;
    // An empty name is rejected; `expires_in_days` is a uint32, so a negative
    // value can never reach here through proto.
    assert_eq!(st, StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cargo test -p transport --test tokens_flow`
Expected: FAIL kompilasi — `cannot find function token_router in crate transport`.

- [ ] **Step 3: Tulis pembacaan token**

Buat `apps/backend-rs/crates/transport/src/tokens/record.rs`:

```rust
//! Reading PATs from the store. A single flat `TokenRecord` so handlers and
//! the `mcp` crate don't have to touch ECS components one by one.

use arke::{Entity, World};
use domain::token::{TokenInfo, TokenOwner, TokenSecret, TokenUsage};
use persistence::Store;

#[derive(Debug, Clone)]
pub struct TokenRecord {
    pub pid: i64,
    pub user_id: String,
    pub name: String,
    pub preview: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
}

fn read(world: &World, e: Entity, pid: i64) -> Option<TokenRecord> {
    let owner = world.get::<TokenOwner>(e)?;
    let info = world.get::<TokenInfo>(e)?;
    let secret = world.get::<TokenSecret>(e)?;
    Some(TokenRecord {
        pid,
        user_id: owner.user_id.clone(),
        name: info.name.clone(),
        preview: secret.preview.clone(),
        created_at: info.created_at.clone(),
        expires_at: info.expires_at.clone(),
        last_used_at: world
            .get::<TokenUsage>(e)
            .and_then(|u| u.last_used_at.clone()),
    })
}

/// One user's tokens, newest first.
///
/// Filter in SQL, not in Rust. `query(None, ..)` would hydrate every token
/// belonging to *every* user before the ownership filter ever runs — and
/// hydrating one pid costs one existence query plus one query per registered
/// component type. That lesson was already paid for once and written up in
/// full, numbers included, at `activity::record::activity_for_project`;
/// `TokenOwner.user_id` is indexed exactly for this query.
pub async fn tokens_for_owner(store: &Store, user_id: &str) -> anyhow::Result<Vec<TokenRecord>> {
    if !crate::sql::safe_sql_id(user_id) {
        return Ok(Vec::new());
    }
    let pred = format!("user_id = '{user_id}'");
    let mut v = store
        .query::<TokenOwner, TokenRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read(world, *e, *pid))
                .collect()
        })
        .await?;
    v.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.pid.cmp(&a.pid)));
    Ok(v)
}

pub async fn load_token(store: &Store, pid: i64) -> anyhow::Result<Option<TokenRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<TokenSecret, TokenRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Lookup by digest — the hot path for every MCP tool call.
///
/// Interpolating into the SQL predicate is safe here: `hash` is always a
/// 64-character hex digest produced by `domain::token::hash_token`, never raw
/// user text (callers must screen through `looks_like_token` first).
pub async fn find_by_hash(store: &Store, hash: &str) -> anyhow::Result<Option<TokenRecord>> {
    let pred = format!("hash = '{hash}'");
    let mut v = store
        .query::<TokenSecret, TokenRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}
```

- [ ] **Step 4: Tulis service-nya**

Buat `apps/backend-rs/crates/transport/src/tokens/token_service.rs`:

```rust
//! AccessTokenService: issue / list / revoke PATs. Entirely self-scoped —
//! the owner is always taken from the JWT, so even an admin can't touch
//! someone else's token. The plaintext exists only once, in the CreateToken
//! response.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::token::{
    generate_token, hash_token, is_expired, preview_of, TokenInfo, TokenOwner, TokenSecret,
    TokenUsage,
};
use persistence::Store;

use super::record::{load_token, tokens_for_owner, TokenRecord};
use crate::sedjiwa::tasks::token::v1 as pb;
use crate::sedjiwa::tasks::token::v1::access_token_service_connect::AccessTokenServiceBuilder;

fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

/// Whole seconds, deliberately. `Rfc3339` only writes a fractional-second part
/// when the nanoseconds aren't zero, and trims trailing zeros when they aren't
/// — so the string width varies. `domain::token::is_expired` compares these
/// strings lexicographically, and that comparison only tracks time order when
/// every side is at the same precision. Pinning the precision here is what
/// makes that precondition actually hold.
fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    let now = time::OffsetDateTime::now_utc();
    now.replace_nanosecond(0)
        .unwrap_or(now)
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// A deliberate upper bound. `OffsetDateTime + Duration` **panics** when the
/// result falls outside the representable range, and `expires_in_days` arrives
/// raw from the client as a `uint32` — without this bound a single request with
/// a huge number crashes the handler instead of getting an `invalid_argument`.
pub(crate) const MAX_EXPIRY_DAYS: u32 = 3650; // 10 years

/// `expires_in_days` → `expires_at` RFC3339. 0 = never expires.
fn expiry_from_days(days: u32) -> Option<String> {
    use time::format_description::well_known::Rfc3339;
    if days == 0 {
        return None;
    }
    let at = time::OffsetDateTime::now_utc() + time::Duration::days(days as i64);
    // Precision pinned the same way as `now_iso` — see the reasoning there.
    at.replace_nanosecond(0).unwrap_or(at).format(&Rfc3339).ok()
}

fn to_proto(t: &TokenRecord, now: &str) -> pb::AccessToken {
    pb::AccessToken {
        id: t.pid.to_string(),
        name: t.name.clone(),
        preview: t.preview.clone(),
        created_at: t.created_at.clone(),
        expires_at: t.expires_at.clone(),
        last_used_at: t.last_used_at.clone(),
        expired: is_expired(t.expires_at.as_deref(), now),
    }
}

async fn create_token(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTokenRequest>,
) -> Result<ConnectResponse<pb::CreateTokenResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let name = r.name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(ConnectError::new_invalid_argument(
            "name is required (max 64 characters)",
        ));
    }
    if r.expires_in_days > MAX_EXPIRY_DAYS {
        return Err(ConnectError::new_invalid_argument(
            "expires_in_days must be 3650 or less",
        ));
    }
    let plaintext = generate_token();
    let now = now_iso();
    let pid = store
        .create((
            TokenSecret {
                hash: hash_token(&plaintext),
                preview: preview_of(&plaintext),
            },
            TokenOwner {
                user_id: auth.id.clone(),
            },
            TokenInfo {
                name: name.to_string(),
                created_at: now.clone(),
                expires_at: expiry_from_days(r.expires_in_days),
            },
            TokenUsage { last_used_at: None },
        ))
        .await
        .map_err(internal)?;
    let rec = load_token(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_internal("token vanished after create"))?;
    Ok(ConnectResponse::new(pb::CreateTokenResponse {
        token: plaintext,
        access_token: Some(to_proto(&rec, &now)),
    }))
}

async fn list_tokens(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::ListTokensRequest>,
) -> Result<ConnectResponse<pb::ListTokensResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let now = now_iso();
    let rows = tokens_for_owner(&store, &auth.id).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListTokensResponse {
        tokens: rows.iter().map(|t| to_proto(t, &now)).collect(),
    }))
}

/// Revoke = delete the entity. A token belonging to someone else answers
/// `not_found`, not `permission_denied`: distinguishing the two would leak
/// which ids exist.
async fn revoke_token(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::RevokeTokenRequest>,
) -> Result<ConnectResponse<pb::RevokeTokenResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = r
        .id
        .parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("token not found"))?;
    let rec = load_token(&store, pid)
        .await
        .map_err(internal)?
        .filter(|t| t.user_id == auth.id)
        .ok_or_else(|| ConnectError::new_not_found("token not found"))?;
    store.delete(rec.pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::RevokeTokenResponse { ok: true }))
}

/// AccessTokenService router; injects the Store as a request extension.
pub fn token_router(store: Arc<Store>) -> axum::Router<()> {
    type S = Extension<Arc<Store>>;
    type A = Option<Extension<AuthUser>>;
    AccessTokenServiceBuilder::<()>::new()
        .create_token::<_, (S, A, ConnectRequest<pb::CreateTokenRequest>)>(create_token)
        .list_tokens::<_, (S, A, ConnectRequest<pb::ListTokensRequest>)>(list_tokens)
        .revoke_token::<_, (S, A, ConnectRequest<pb::RevokeTokenRequest>)>(revoke_token)
        .build()
        .layer(Extension(store))
}
```

`safe_sql_id` saat ini fungsi privat di `crates/transport/src/activity/record.rs`.
Karena `tokens/record.rs` jadi pemakai keduanya, **pindahkan — jangan salin** — ke
modul bersama `apps/backend-rs/crates/transport/src/sql.rs`:

```rust
//! Guard for values that go into a `Store::query` SQL predicate.
//!
//! `Store::query`'s `predicate` is trusted raw SQL, not a bound parameter.
//! Every id that originates outside this crate must pass through this gate
//! before being interpolated.

/// An id safe to interpolate: non-empty, at most 64 characters, and only
/// ASCII alphanumerics, `_`, or `-`.
pub(crate) fn safe_sql_id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
```

Tambahkan `mod sql;` di `crates/transport/src/lib.rs`, hapus definisi lama di
`activity/record.rs`, dan arahkan pemakaiannya ke `crate::sql::safe_sql_id`. Test
activity yang ada harus tetap hijau tanpa disunting — itu buktinya pemindahan ini
tidak mengubah perilaku.

Buat `apps/backend-rs/crates/transport/src/tokens/mod.rs`:

```rust
//! Access tokens (PAT) for the MCP endpoint. See
//! docs/superpowers/specs/2026-09-02-mcp-server-design.md.

pub(crate) mod record;
mod token_service;

pub use token_service::token_router;
```

- [ ] **Step 5: Ekspor dari lib.rs dan pasang di router aplikasi**

Di `apps/backend-rs/crates/transport/src/lib.rs`, tambahkan `mod tokens;` pada daftar modul dan `pub use tokens::token_router;` pada daftar re-export.

Di `apps/backend-rs/crates/app/src/router.rs`, sisipkan satu baris pada rantai merge, tepat setelah `.merge(transport::user_router(store.clone()))`:

```rust
        .merge(transport::token_router(store.clone()))
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `DATABASE_URL=$DATABASE_URL cargo test -p transport --test tokens_flow`
Expected: PASS, 4 test. Catatan: run pertama pada database kosong selalu gagal sekali karena tabel komponen baru dibuat pada run itu — jalankan ulang sekali dan pastikan hijau. Tanpa `DATABASE_URL`, test lulus tanpa menguji apa pun (skip diam-diam).

- [ ] **Step 7: Commit**

```bash
git add apps/backend-rs/crates/transport/src/tokens apps/backend-rs/crates/transport/src/lib.rs \
        apps/backend-rs/crates/transport/tests/tokens_flow.rs apps/backend-rs/crates/app/src/router.rs
git commit -m "feat(tokens): add self-scoped AccessTokenService"
```

---

# Phase 2 — Ekstraksi core fn

Fase ini murni refactor: **tidak ada perilaku yang berubah, dan tidak ada file test yang boleh disunting.** Seluruh `crates/transport/tests/*_flow.rs` yang ada adalah jaring pengamannya — bila salah satunya perlu diubah agar hijau, itu tanda ekstraksinya mengubah perilaku dan harus diperbaiki, bukan test-nya.

**Aturan mekanis yang berlaku untuk setiap handler:** badan fungsi dipindahkan apa adanya ke sebuah `_core` yang menerima nilai biasa, dan handler Connect menjadi pembungkus yang hanya membongkar extractor.

Contoh lengkap, `get_task` di `crates/transport/src/work/task_service.rs:86-98`. Sebelum:

```rust
async fn get_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let t = require_task(&store, pid).await?;
    let (_, project_id) = module_project(&store, &t.module_id).await?;
    require_member(&store, &project_id, &auth).await?;
    Ok(ConnectResponse::new(to_proto(&t)))
}
```

Sesudah:

```rust
/// Core: a single task by id, member-gated through module → project.
pub async fn get_task_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::GetTaskRequest,
) -> Result<pb::Task, ConnectError> {
    let pid = parse_pid(&r.id)?;
    let t = require_task(store, pid).await?;
    let (_, project_id) = module_project(store, &t.module_id).await?;
    require_member(store, &project_id, auth).await?;
    Ok(to_proto(&t))
}

async fn get_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(get_task_core(&store, &auth, r).await?))
}
```

Yang berubah hanyalah: extractor pindah ke pembungkus, `&store` menjadi `store`, `&auth` menjadi `auth`, dan `ConnectResponse::new(..)` pindah ke pembungkus. Isi logikanya tidak disentuh.

## Task 4: Core fn untuk task

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/work/task_service.rs`, `apps/backend-rs/crates/transport/src/work/mod.rs`
- Create: `apps/backend-rs/crates/transport/src/api.rs`
- Test: `apps/backend-rs/crates/transport/tests/work_flow.rs` (sudah ada, tidak diubah)

- [ ] **Step 1: Catat baseline hijau**

Run: `cargo test -p transport --test work_flow`
Expected: PASS. Catat jumlah test-nya — angka itu harus sama persis di akhir task.

- [ ] **Step 2: Ekstrak lima core fn**

Di `task_service.rs`, terapkan aturan mekanis di atas pada `get_task`, `list_tasks`, `create_task`, `update_task`, dan `move_task`. `delete_task` **tidak** diekstrak — ia tidak dipakai MCP (lihat spec).

Dua di antaranya juga mengambil `Notifier`, jadi core fn-nya menerimanya sebagai parameter biasa — MCP wajib meneruskannya agar task yang dibuat lewat AI tetap memberi notifikasi ke assignee-nya:

```rust
pub async fn create_task_core(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    auth: &AuthUser,
    r: pb::CreateTaskRequest,
) -> Result<pb::Task, ConnectError> { /* create_task's body, minus the extractor lines */ }

pub async fn update_task_core(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    auth: &AuthUser,
    r: pb::UpdateTaskRequest,
) -> Result<pb::Task, ConnectError> { /* idem */ }
```

Di dalam badan yang dipindah, setiap pemakaian `notifier` yang tadinya berbentuk `Option<Extension<Arc<Notifier>>>` menjadi `notifier` (sudah `Option<&Arc<Notifier>>`); sesuaikan pemanggilan `emit(..)` mengikuti bentuk barunya.

Handler pembungkusnya:

```rust
async fn create_task(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let n = notifier.as_ref().map(|Extension(n)| n);
    Ok(ConnectResponse::new(
        create_task_core(&store, n, &auth, r).await?,
    ))
}
```

Signature dua sisanya:

```rust
pub async fn list_tasks_core(store: &Store, auth: &AuthUser, r: pb::ListTasksRequest)
    -> Result<pb::ListTasksResponse, ConnectError>;
pub async fn move_task_core(store: &Store, auth: &AuthUser, r: pb::MoveTaskRequest)
    -> Result<pb::Task, ConnectError>;
```

- [ ] **Step 3: Buka modulnya dan buat permukaan `api`**

Di `crates/transport/src/work/mod.rs`, ubah `mod task_service;` menjadi `pub(crate) mod task_service;`.

Perhatikan visibilitas: setiap `_core` dideklarasikan `pub`, bukan `pub(crate)`.
Modulnya tetap `pub(crate)`, tetapi `api.rs` me-*re-export* fungsi-fungsi itu secara
publik, dan `pub use` atas item `pub(crate)` adalah error kompilasi (E0365). Item `pub`
di dalam modul privat tidak bocor ke luar crate kecuali lewat re-export itu, jadi
permukaan publiknya tetap persis yang `api.rs` sebutkan.

Buat `apps/backend-rs/crates/transport/src/api.rs`:

```rust
//! In-process service surface: the exact same functions the Connect handlers
//! call, minus the axum extractors.
//!
//! Exists so the `mcp` crate can reuse the business logic as-is —
//! member-gating, validation, activity recording, notifications, and search
//! indexing all come along for the ride. Duplicating those rules on the MCP
//! side is the fastest way to make AI and UI behavior silently diverge.
//!
//! Two exports break that rule, deliberately: `find_by_hash` and `auth_user_for`
//! back no Connect handler at all. They exist because the MCP endpoint
//! authenticates with a personal access token rather than the JWT `auth_layer`
//! gives every other route, so it has to resolve a credential to a user itself.
//! They are listed apart from the core fns below for that reason.

pub use crate::work::task_service::{
    create_task_core, get_task_core, list_tasks_core, move_task_core, update_task_core,
};
```

Di `crates/transport/src/lib.rs`, tambahkan `pub mod api;` di dekat deklarasi modul lain.

- [ ] **Step 4: Pastikan tidak ada perilaku yang berubah**

Run: `cargo test -p transport --test work_flow`
Expected: PASS dengan jumlah test sama seperti Step 1, tanpa satu pun baris test disunting.

Run: `cargo clippy -p transport --all-targets`
Expected: tidak ada peringatan baru dari pekerjaanmu.

**Dua peringatan `dead_code` yang diketahui.** Sampai Task 8 mem-wire jalur PAT,
`tokens::record::find_by_hash` memang belum punya pemanggil, dan `export/model.rs`
punya `storage_key` yang sudah menganggur sejak sebelum rencana ini. Keduanya membuat
`-D warnings` gagal. Itu bukan temuan — yang harus dipastikan adalah **tidak ada
peringatan ketiga** yang muncul dari pekerjaanmu. Jalankan tanpa `-D warnings` dan
bandingkan daftarnya. Jangan membungkam keduanya dengan `#[allow]`: peringatan
`find_by_hash` adalah penanda bahwa Task 8 belum selesai, dan hilangnya peringatan itu
nanti adalah buktinya sudah tersambung.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/work apps/backend-rs/crates/transport/src/api.rs \
        apps/backend-rs/crates/transport/src/lib.rs
git commit -m "refactor(transport): extract task core fns for in-process reuse"
```

---

## Task 5: Core fn untuk project & module

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/projects/*`, `apps/backend-rs/crates/transport/src/work/module_service.rs`, `apps/backend-rs/crates/transport/src/work/mod.rs`, `apps/backend-rs/crates/transport/src/api.rs`
- Test: `crates/transport/tests/project_flow.rs`, `crates/transport/tests/work_flow.rs` (sudah ada, tidak diubah)

- [ ] **Step 1: Catat baseline hijau**

Run: `cargo test -p transport --test project_flow --test work_flow`
Expected: PASS. Catat jumlah test-nya.

- [ ] **Step 2: Ekstrak tiga core fn**

Terapkan aturan mekanis yang sama pada `list_projects` dan `get_project` di modul `projects`, serta `list_modules` di `work/module_service.rs`. Signature targetnya:

```rust
pub async fn list_projects_core(store: &Store, auth: &AuthUser, r: pb::ListProjectsRequest)
    -> Result<pb::ListProjectsResponse, ConnectError>;
pub async fn get_project_core(store: &Store, auth: &AuthUser, r: pb::GetProjectRequest)
    -> Result<pb::Project, ConnectError>;
pub async fn list_modules_core(store: &Store, auth: &AuthUser, r: pb::ListModulesRequest)
    -> Result<pb::ListModulesResponse, ConnectError>;
```

Bila nama request/response di proto berbeda dari tebakan di atas, pakai nama yang sebenarnya ada di `proto/projects.proto` dan `proto/work.proto` — signature-nya mengikuti proto, bukan sebaliknya.

Buka modulnya sesuai kebutuhan: `pub(crate) mod module_service;` di `work/mod.rs`, dan modul service project di `projects/mod.rs`.

- [ ] **Step 3: Ekspor lewat `api`**

Tambahkan di `crates/transport/src/api.rs`:

```rust
pub use crate::projects::project_service::{get_project_core, list_projects_core};
pub use crate::work::module_service::list_modules_core;
```

Sesuaikan nama modulnya dengan struktur `projects/` yang sebenarnya.

- [ ] **Step 4: Pastikan tidak ada perilaku yang berubah**

Run: `cargo test -p transport --test project_flow --test work_flow`
Expected: PASS, jumlah test sama seperti Step 1.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src
git commit -m "refactor(transport): extract project and module core fns"
```

---

## Task 6: Core fn untuk comment, search, dan my-tasks

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/comments/*`, `.../search/*`, `.../dashboard/*`, `apps/backend-rs/crates/transport/src/api.rs`
- Test: `crates/transport/tests/comment_flow.rs`, `search_flow.rs`, `dashboard_flow.rs` (sudah ada, tidak diubah)

- [ ] **Step 1: Catat baseline hijau**

Run: `cargo test -p transport --test comment_flow --test search_flow --test dashboard_flow`
Expected: PASS. Catat jumlah test-nya.

- [ ] **Step 2: Ekstrak empat core fn**

Aturan mekanis yang sama. `create_comment` juga memegang `Notifier` (mention → notifikasi), jadi ia mengikuti bentuk `create_task_core`:

```rust
pub async fn list_comments_core(store: &Store, auth: &AuthUser, r: pb::ListCommentsRequest)
    -> Result<pb::ListCommentsResponse, ConnectError>;
pub async fn create_comment_core(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    auth: &AuthUser,
    r: pb::CreateCommentRequest,
) -> Result<pb::Comment, ConnectError>;
pub async fn search_core(store: &Store, auth: &AuthUser, r: pb::SearchRequest)
    -> Result<pb::SearchResponse, ConnectError>;
// MyTasksService is three RPCs sharing one request/response pair, so this is
// three extractions, not one. Do not collapse them — each applies a different
// filter, and a single core fn would have to guess which.
pub async fn list_assigned_to_me_core(store: &Store, auth: &AuthUser, r: pb::MyTasksRequest)
    -> Result<pb::MyTasksResponse, ConnectError>;
pub async fn list_created_by_me_core(store: &Store, auth: &AuthUser, r: pb::MyTasksRequest)
    -> Result<pb::MyTasksResponse, ConnectError>;
pub async fn list_involving_me_core(store: &Store, auth: &AuthUser, r: pb::MyTasksRequest)
    -> Result<pb::MyTasksResponse, ConnectError>;
```

Pakai nama message yang sebenarnya dari `proto/search.proto` dan `proto/dashboard.proto`.

- [ ] **Step 3: Ekspor lewat `api`**

Tambahkan re-export-nya di `crates/transport/src/api.rs`, mengikuti jalur modul yang sebenarnya.

- [ ] **Step 4: Pastikan tidak ada perilaku yang berubah**

Run: `cargo test -p transport`
Expected: PASS untuk seluruh test transport, jumlahnya sama seperti sebelum Phase 2 dimulai.

Run: `cargo clippy --workspace --all-targets`
Expected: tidak ada peringatan baru dari pekerjaanmu.

**Dua peringatan `dead_code` yang diketahui.** Sampai Task 8 mem-wire jalur PAT,
`tokens::record::find_by_hash` memang belum punya pemanggil, dan `export/model.rs`
punya `storage_key` yang sudah menganggur sejak sebelum rencana ini. Keduanya membuat
`-D warnings` gagal. Itu bukan temuan — yang harus dipastikan adalah **tidak ada
peringatan ketiga** yang muncul dari pekerjaanmu. Jalankan tanpa `-D warnings` dan
bandingkan daftarnya. Jangan membungkam keduanya dengan `#[allow]`: peringatan
`find_by_hash` adalah penanda bahwa Task 8 belum selesai, dan hilangnya peringatan itu
nanti adalah buktinya sudah tersambung.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src
git commit -m "refactor(transport): extract comment, search, and my-tasks core fns"
```

---

# Phase 3 — Crate MCP

## Task 7: Kerangka crate + envelope JSON-RPC

**Files:**
- Create: `apps/backend-rs/crates/mcp/Cargo.toml`, `apps/backend-rs/crates/mcp/src/lib.rs`, `apps/backend-rs/crates/mcp/src/protocol.rs`, `apps/backend-rs/crates/mcp/tests/mcp_flow.rs`

- [ ] **Step 1: Buat manifest**

`apps/backend-rs/crates/mcp/Cargo.toml`:

```toml
[package]
name = "mcp"
edition.workspace = true
version.workspace = true

[dependencies]
axum = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
time = { workspace = true }
tracing = { workspace = true }
anyhow = { workspace = true }
connectrpc-axum = { workspace = true }
auth = { path = "../auth" }
domain = { path = "../domain" }
persistence = { path = "../persistence" }
transport = { path = "../transport" }

[dev-dependencies]
tower = { workspace = true }
```

Crate ini otomatis ikut workspace (`members = ["crates/*"]`).

- [ ] **Step 2: Tulis test handshake yang gagal**

`apps/backend-rs/crates/mcp/tests/mcp_flow.rs`:

```rust
//! End-to-end MCP endpoint.
//!
//! Every test here needs `DATABASE_URL`, including the handshake ones: building the
//! router needs a `Store` even though the handshake never reads it. Without the
//! variable each test returns early, and cargo reports that as a pass — so the skip
//! prints a marker rather than vanishing. A run that prints nothing is a run that
//! tested something.

use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::Router;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

async fn router_and_store() -> Option<(Router, Arc<persistence::Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(
        persistence::Store::connect(&url, domain::register_all)
            .await
            .unwrap(),
    );
    let notifier = Arc::new(transport::Notifier::new());
    let router = Router::new().nest("/mcp", mcp::mcp_router(store.clone(), notifier));
    Some((router, store))
}

/// Tests that don't touch the store only need the router.
async fn router() -> Option<Router> {
    Some(router_and_store().await?.0)
}

/// Say so, loudly, when a test is about to no-op. Cargo counts an early return as a
/// pass, so silence here is indistinguishable from success.
fn skipped() {
    // A test's thread carries its own name, so the marker names itself.
    let name = std::thread::current().name().unwrap_or("test").to_string();
    eprintln!("SKIP {name}: DATABASE_URL is not set, this test asserted nothing");
}

async fn rpc(router: &Router, bearer: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json");
    if let Some(t) = bearer {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn initialize_returns_capabilities() {
    let Some(router) = router().await else { return skipped() };
    let (st, body) = rpc(
        &router,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-06-18", "capabilities": {} }
        }),
    )
    .await;
    // The handshake needs no credentials — a client must be able to discover
    // the server before the user pastes in a token.
    assert_eq!(st, StatusCode::OK, "{body:?}");
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], 1);
    assert!(body["result"]["capabilities"]["tools"].is_object());
    assert_eq!(body["result"]["serverInfo"]["name"], "sedjiwa-tasks");
}

#[tokio::test]
async fn notification_gets_202_and_no_body() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
        ))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn unknown_method_is_a_jsonrpc_error() {
    let Some(router) = router().await else { return skipped() };
    let (st, body) = rpc(
        &router,
        None,
        json!({ "jsonrpc": "2.0", "id": 9, "method": "does/not/exist" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["error"]["code"], -32601);
}

#[tokio::test]
async fn malformed_json_is_a_parse_error() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from("{ not json"))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["error"]["code"], -32700);
}

#[tokio::test]
async fn get_is_not_supported() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder().method("GET").uri("/mcp").body(Body::empty()).unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
}
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `cargo test -p mcp`
Expected: FAIL kompilasi — crate `mcp` belum punya `mcp_router`.

- [ ] **Step 4: Tulis lapis protokol**

`apps/backend-rs/crates/mcp/src/protocol.rs`:

```rust
//! JSON-RPC 2.0 envelope for MCP over Streamable HTTP.
//!
//! Stateless: there's no `Mcp-Session-Id`. Every request carries its own PAT,
//! so there's no session state to hold and any instance may serve any
//! request.

use serde::Deserialize;
use serde_json::{json, Value};

/// MCP spec versions we serve, newest first. If the client requests one of
/// these we answer with exactly that one; otherwise we answer with the first
/// and the client decides whether it still wants to proceed.
pub const SUPPORTED_VERSIONS: [&str; 2] = ["2025-06-18", "2025-03-26"];

pub const PARSE_ERROR: i64 = -32700;
/// Well-formed JSON that is not a JSON-RPC request. Distinct from PARSE_ERROR on
/// purpose: it tells a client its request builder is wrong, not its transport.
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;

#[derive(Debug, Deserialize)]
pub struct Rpc {
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

pub fn result(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn error(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// The `initialize` reply. We only advertise `tools` — v1 has no `resources`,
/// `prompts`, or server-initiated messages.
pub fn initialize_result(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("");
    let version = SUPPORTED_VERSIONS
        .iter()
        .find(|v| **v == requested)
        .copied()
        .unwrap_or(SUPPORTED_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "sedjiwa-tasks", "version": env!("CARGO_PKG_VERSION") }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echoes_a_supported_version() {
        let p = json!({ "protocolVersion": "2025-03-26" });
        assert_eq!(initialize_result(&p)["protocolVersion"], "2025-03-26");
    }

    #[test]
    fn falls_back_to_latest_for_unknown_version() {
        let p = json!({ "protocolVersion": "1999-01-01" });
        assert_eq!(initialize_result(&p)["protocolVersion"], SUPPORTED_VERSIONS[0]);
    }
}
```

- [ ] **Step 5: Tulis router-nya**

`apps/backend-rs/crates/mcp/src/lib.rs`:

```rust
//! MCP endpoint: a single Streamable HTTP route that exposes the portal's
//! tools to a user's own AI client, authenticated with a personal access
//! token.
//!
//! Mounted at `/mcp` on the server; public at `/api/tasks-rs/mcp` (the proxy
//! strips the `/api/tasks-rs` prefix, same as for Connect routes).

mod protocol;

use std::sync::Arc;

use axum::extract::Extension;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Json;
use persistence::Store;
use serde_json::Value;
use transport::Notifier;

use protocol::{
    error, initialize_result, result, Rpc, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR,
};

#[derive(Clone)]
pub struct McpState {
    pub store: Arc<Store>,
    pub notifier: Arc<Notifier>,
}

/// MCP endpoint router. Mount with `Router::new().nest("/mcp", mcp_router(..))`.
pub fn mcp_router(store: Arc<Store>, notifier: Arc<Notifier>) -> axum::Router<()> {
    axum::Router::new()
        .route("/", post(handle_post).get(handle_get))
        .layer(Extension(McpState { store, notifier }))
}

/// GET is used by the spec to open a server→client SSE stream. v1 has no
/// server-initiated messages, so refusing it is more honest than opening a
/// stream that will never send anything.
async fn handle_get() -> Response {
    StatusCode::METHOD_NOT_ALLOWED.into_response()
}

async fn handle_post(
    Extension(_state): Extension<McpState>,
    body: axum::body::Bytes,
) -> Response {
    // Two stages, because these are two different client bugs: a body that is not
    // JSON at all, and a body that is JSON but not a JSON-RPC request. Collapsing
    // them into one code tells a client its transport is broken when its request
    // builder is what is actually wrong.
    let Ok(raw) = serde_json::from_slice::<Value>(&body) else {
        return Json(error(None, PARSE_ERROR, "request body is not valid JSON")).into_response();
    };
    let id = raw.get("id").cloned();
    let Ok(rpc) = serde_json::from_value::<Rpc>(raw) else {
        return Json(error(id, INVALID_REQUEST, "not a valid JSON-RPC request")).into_response();
    };

    // A notification (no `id`) is never answered — the spec calls for an empty 202.
    let is_notification = rpc.id.is_none();

    let response: Value = match rpc.method.as_str() {
        "initialize" => result(rpc.id.clone(), initialize_result(&rpc.params)),
        "ping" => result(rpc.id.clone(), serde_json::json!({})),
        m if m.starts_with("notifications/") => {
            return StatusCode::ACCEPTED.into_response();
        }
        other => error(rpc.id.clone(), METHOD_NOT_FOUND, &format!("unknown method: {other}")),
    };

    if is_notification {
        return StatusCode::ACCEPTED.into_response();
    }
    Json(response).into_response()
}
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `cargo test -p mcp`
Expected: PASS (7 test: 5 di `mcp_flow`, 2 unit di `protocol`).

- [ ] **Step 7: Commit**

```bash
git add apps/backend-rs/crates/mcp apps/backend-rs/Cargo.lock
git commit -m "feat(mcp): add MCP crate with JSON-RPC envelope"
```

---

## Task 8: Autentikasi PAT

**Files:**
- Create: `apps/backend-rs/crates/mcp/src/pat.rs`
- Modify: `apps/backend-rs/crates/mcp/src/lib.rs`, `apps/backend-rs/crates/transport/src/api.rs`, `apps/backend-rs/crates/transport/src/users/record.rs`, `apps/backend-rs/crates/mcp/tests/mcp_flow.rs`

- [ ] **Step 1: Tambahkan test yang gagal**

Tambahkan di ujung `crates/mcp/tests/mcp_flow.rs`:

```rust
#[tokio::test]
async fn tools_list_without_token_is_401() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }).to_string(),
        ))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    // Bad credentials are distinguished from a bad request: 401 +
    // WWW-Authenticate, not a JSON-RPC error, so the client knows it's a
    // token problem.
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert!(resp.headers().get("www-authenticate").is_some());
}

#[tokio::test]
async fn garbage_token_is_401() {
    let Some(router) = router().await else { return skipped() };
    let (st, _) = rpc(
        &router,
        Some("not-a-real-token"),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" }),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}
```

Run: `cargo test -p mcp`
Expected: FAIL — `tools/list` masih dibalas `-32601` dengan status 200.

- [ ] **Step 2: Ekspos resolusi user dari transport**

Di `crates/transport/src/users/record.rs`, tambahkan:

```rust
/// The `AuthUser` a Connect handler would see for this user — used by the PAT
/// path, which carries the owner's id but not their permissions.
///
/// Permissions are read fresh each time rather than frozen into the token:
/// that's what makes a token automatically lose its rights the moment the
/// user is suspended or has their admin status revoked.
pub async fn auth_user_for(store: &Store, user_id: &str) -> anyhow::Result<Option<AuthUser>> {
    let Ok(pid) = user_id.parse::<i64>() else {
        return Ok(None);
    };
    let Some(u) = load_user(store, pid).await? else {
        return Ok(None);
    };
    if domain::user::UserStatus::parse(&u.status) != Some(domain::user::UserStatus::Active) {
        return Ok(None);
    }
    Ok(Some(AuthUser {
        id: user_id.to_string(),
        permissions: if u.is_admin { vec!["*".to_string()] } else { vec![] },
    }))
}
```

Sesuaikan nama field `u.status` / `u.is_admin` dengan `UserRecord` yang sebenarnya ada di file itu. Tambahkan `use auth::AuthUser;` bila belum ada.

Di `crates/transport/src/api.rs`, tambahkan:

```rust
// Not core fns: the PAT path resolves its own credential (see the module doc).
pub use crate::tokens::record::{find_by_hash, TokenRecord};
pub use crate::users::record::auth_user_for;
```

Pastikan `mod users` / `mod tokens` mengekspos `pub(crate) mod record;` dan item di dalamnya `pub`.

- [ ] **Step 3: Tulis verifikasi PAT**

`apps/backend-rs/crates/mcp/src/pat.rs`:

```rust
//! Verifying personal access tokens for the MCP endpoint.
//!
//! This path is deliberately separate from the application's `auth_layer`:
//! the browser session JWT doesn't work here, and a PAT doesn't work against
//! the Connect API. The two credentials never cross paths, so a leaked PAT
//! only opens up the MCP tools.

use auth::AuthUser;
use domain::token::{hash_token, is_expired, looks_like_token};
use persistence::Store;
use transport::api::{auth_user_for, find_by_hash, TokenRecord};

/// Why a request was refused.
///
/// Every *credential* failure collapses into one variant on purpose: telling a
/// guesser their token was expired rather than unknown tells them the guess was
/// nearly right. Infrastructure failure is separate, because it is not the
/// caller's fault — answering 401 sends a user off to reissue a token that was
/// never the problem, and an outage dressed as a wave of 401s is something an
/// operator would struggle to recognise. Nothing an attacker controls selects
/// between the two variants, so the split leaks nothing.
#[derive(Debug)]
pub enum AuthFailure {
    Unauthorized,
    Unavailable,
}

/// Whole seconds, deliberately. `Rfc3339` only writes a fractional-second part
/// when the nanoseconds aren't zero, and trims trailing zeros when they aren't
/// — so the string width varies. `domain::token::is_expired` compares these
/// strings lexicographically, and that comparison only tracks time order when
/// every side is at the same precision. Pinning the precision here is what
/// makes that precondition actually hold.
fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    let now = time::OffsetDateTime::now_utc();
    now.replace_nanosecond(0)
        .unwrap_or(now)
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// `Authorization` header → the portal user, or `Unauthorized`.
/// The client learns only that it was refused. The log records which branch
/// fired, because "someone is hammering us with garbage" and "a real user's
/// token expired last week" need different responses from an operator, and this
/// function is the only place that still knows the difference.
pub async fn authenticate(store: &Store, header: Option<&str>) -> Result<AuthUser, AuthFailure> {
    let Some(raw) = header else {
        tracing::debug!("mcp: request carried no Authorization header");
        return Err(AuthFailure::Unauthorized);
    };
    let Some(token) = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .map(str::trim)
    else {
        tracing::debug!("mcp: Authorization header is not a Bearer credential");
        return Err(AuthFailure::Unauthorized);
    };
    // Screen the shape first: a string we could never have issued never reaches
    // the database, and that is also what makes the digest safe to interpolate
    // into `find_by_hash`'s SQL predicate.
    if !looks_like_token(token) {
        tracing::debug!("mcp: bearer credential is not shaped like a token");
        return Err(AuthFailure::Unauthorized);
    }
    let found = find_by_hash(store, &hash_token(token)).await.map_err(|e| {
        tracing::error!(error = %e, "mcp: token lookup failed");
        AuthFailure::Unavailable
    })?;
    let Some(rec) = found else {
        tracing::debug!("mcp: no token matches that digest");
        return Err(AuthFailure::Unauthorized);
    };
    // Expiry before owner resolution: a dead token is not worth a second
    // round-trip to load the user it used to belong to.
    let now = now_iso();
    if is_expired(rec.expires_at.as_deref(), &now) {
        tracing::debug!(token = rec.pid, "mcp: token has expired");
        return Err(AuthFailure::Unauthorized);
    }
    let owner = auth_user_for(store, &rec.user_id).await.map_err(|e| {
        tracing::error!(error = %e, "mcp: owner lookup failed");
        AuthFailure::Unavailable
    })?;
    let Some(user) = owner else {
        tracing::warn!(token = rec.pid, "mcp: token outlived its owner or the owner is not active");
        return Err(AuthFailure::Unauthorized);
    };
    // Only after both checks pass: a refused attempt is not usage.
    touch(store, &rec, &now).await;
    Ok(user)
}

/// Record usage, but skip the write if it was already recorded within the hour.
///
/// This is a throttle, not a lock. Concurrent calls each read the same stale
/// timestamp and each decide to write, so a burst from one conversation can still
/// produce a handful of writes — it bounds the steady state, not the burst.
/// That is deliberate: the value is a timestamp a human glances at occasionally,
/// and paying for an atomic conditional update to spare it a few redundant writes
/// would cost more than it saves.
///
/// Without this throttle, every tool call — and a single AI conversation can
/// trigger a dozen — would write a database row just to refresh a timestamp
/// that a human reads only occasionally.
async fn touch(store: &Store, rec: &TokenRecord, now: &str) {
    use time::format_description::well_known::Rfc3339;
    let at = time::OffsetDateTime::now_utc() - time::Duration::hours(1);
    let cutoff = at
        .replace_nanosecond(0)
        .unwrap_or(at)
        .format(&Rfc3339)
        .unwrap_or_default();
    let fresh = rec
        .last_used_at
        .as_deref()
        .map(|t| t > cutoff.as_str())
        .unwrap_or(false);
    if fresh {
        return;
    }
    let stamp = now.to_string();
    if let Err(e) = store
        .update(rec.pid, move |w, e| {
            w.remove::<domain::token::TokenUsage>(e);
            w.insert(
                e,
                domain::token::TokenUsage {
                    last_used_at: Some(stamp),
                },
            );
        })
        .await
    {
        // Failing to record usage must not fail the tool call itself.
        tracing::warn!(error = %e, token = rec.pid, "failed to record token usage");
    }
}
```

- [ ] **Step 4: Pasang di router**

Tambahkan dulu satu helper di `crates/mcp/src/lib.rs`, karena Task 9 memakainya juga:

```rust
/// Bad or missing credentials answer at the HTTP layer, not as a JSON-RPC error:
/// a client needs to tell "my token is wrong" apart from "my request was wrong",
/// and only the former is worth re-prompting the user about.
fn unauthorized(id: Option<Value>) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [("WWW-Authenticate", "Bearer realm=\"sedjiwa-tasks-mcp\"")],
        Json(error(id, -32001, "invalid or missing access token")),
    )
        .into_response()
}
```


Di `crates/mcp/src/lib.rs`, tambahkan `mod pat;`, lalu ubah `handle_post` agar meminta kredensial untuk semua method **kecuali** handshake:

```rust
async fn handle_post(
    Extension(state): Extension<McpState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // Two stages, because these are two different client bugs: a body that is not
    // JSON at all, and a body that is JSON but not a JSON-RPC request. Collapsing
    // them into one code tells a client its transport is broken when its request
    // builder is what is actually wrong.
    let Ok(raw) = serde_json::from_slice::<Value>(&body) else {
        return Json(error(None, PARSE_ERROR, "request body is not valid JSON")).into_response();
    };
    let id = raw.get("id").cloned();
    let Ok(rpc) = serde_json::from_value::<Rpc>(raw) else {
        return Json(error(id, INVALID_REQUEST, "not a valid JSON-RPC request")).into_response();
    };
    let is_notification = rpc.id.is_none();

    // `initialize`/`ping` are deliberately open: a client must be able to
    // finish the handshake and display the server's name before the user
    // pastes in a token.
    let needs_auth = !matches!(rpc.method.as_str(), "initialize" | "ping")
        && !rpc.method.starts_with("notifications/");
    let auth = if needs_auth {
        let header = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok());
        match pat::authenticate(&state.store, header).await {
            Ok(u) => Some(u),
            Err(pat::AuthFailure::Unauthorized) => return unauthorized(rpc.id),
            // Not the caller's credentials, so do not tell them it was.
            Err(pat::AuthFailure::Unavailable) => {
                return Json(error(rpc.id, INTERNAL_ERROR, "the server could not verify credentials"))
                    .into_response()
            }
        }
    } else {
        None
    };
    let _ = &auth; // used starting from Task 9

    let response: Value = match rpc.method.as_str() { /* same as Task 7 */ };

    if is_notification {
        return StatusCode::ACCEPTED.into_response();
    }
    Json(response).into_response()
}
```

- [ ] **Step 4b: Pagari properti keamanannya dengan test**

Tiga jaminan di task ini — token kedaluwarsa ditolak, token milik user non-aktif
ditolak, dan semua penolakan tampak identik — tidak dijaga test apa pun kalau hanya
dua test di Step 1 yang ditulis. Jaminan yang tak dijaga test hanyalah jaminan sampai
seseorang menyunting file itu.

Generalkan dulu helper penyemainya di `crates/mcp/tests/mcp_flow.rs` supaya bisa
mengatur status user dan masa berlaku token, lalu tulis ulang `seed_authed_user`
di atasnya:

```rust
/// Seed a user plus one token for it. Returns (user pid, token pid, plaintext).
async fn seed_user_with_token(
    store: &persistence::Store,
    status: domain::user::UserStatus,
    expires_at: Option<String>,
) -> (i64, i64, String) {
    let now = "2026-01-01T00:00:00Z".to_string();
    let uid = store
        .create((
            domain::user::UserPhone { value: format!("+1555{}", uniq()), verified: true },
            domain::user::UserPassword {
                hash: "unused-in-this-test".into(),
                changed_at: now.clone(),
            },
            domain::user::UserProfile {
                display_name: "MCP Test User".into(),
                avatar_url: String::new(),
                email: String::new(),
            },
            domain::user::UserStatusComponent {
                status: status.as_str().to_string(),
                created_at: now.clone(),
                last_login_at: None,
            },
        ))
        .await
        .unwrap();
    let plaintext = domain::token::generate_token();
    let tid = store
        .create((
            domain::token::TokenSecret {
                hash: domain::token::hash_token(&plaintext),
                preview: domain::token::preview_of(&plaintext),
            },
            domain::token::TokenOwner { user_id: uid.to_string() },
            domain::token::TokenInfo {
                name: "mcp-flow-test".into(),
                created_at: now,
                expires_at,
            },
            domain::token::TokenUsage { last_used_at: None },
        ))
        .await
        .unwrap();
    (uid, tid, plaintext)
}

async fn seed_authed_user(store: &persistence::Store) -> String {
    seed_user_with_token(store, domain::user::UserStatus::Active, None).await.2
}
```

Lalu test-nya. Yang terakhir menguji properti keamanannya secara langsung, bukan
tiap kasus satu per satu:

```rust
#[tokio::test]
async fn expired_token_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, _, token) = seed_user_with_token(
        &store,
        domain::user::UserStatus::Active,
        Some("2020-01-01T00:00:00Z".into()),
    )
    .await;
    let (st, _) = rpc(&router, Some(&token), json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list"
    }))
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn suspended_users_token_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    // The token itself is perfectly valid. What changed is the user behind it —
    // which is exactly why permissions are read fresh instead of baked into the
    // token at issue time.
    let (_, _, token) =
        seed_user_with_token(&store, domain::user::UserStatus::Suspended, None).await;
    let (st, _) = rpc(&router, Some(&token), json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list"
    }))
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn revoked_token_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, tid, token) =
        seed_user_with_token(&store, domain::user::UserStatus::Active, None).await;
    store.delete(tid).await.unwrap();
    let (st, _) = rpc(&router, Some(&token), json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list"
    }))
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

/// Every way of failing must look the same from outside. A response that says
/// "expired" where another says "unknown" tells someone guessing that their
/// guess was nearly right.
#[tokio::test]
async fn every_rejection_is_indistinguishable() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, tid, revoked) =
        seed_user_with_token(&store, domain::user::UserStatus::Active, None).await;
    store.delete(tid).await.unwrap();
    let (_, _, expired) = seed_user_with_token(
        &store,
        domain::user::UserStatus::Active,
        Some("2020-01-01T00:00:00Z".into()),
    )
    .await;
    let (_, _, suspended) =
        seed_user_with_token(&store, domain::user::UserStatus::Suspended, None).await;

    let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    let mut seen = Vec::new();
    for bearer in [
        None,
        Some("not-a-token"),
        Some("sjw_pat_0000000000000000000000000000000000000000000000000000000000000000"),
        Some(revoked.as_str()),
        Some(expired.as_str()),
        Some(suspended.as_str()),
    ] {
        seen.push(rpc(&router, bearer, req.clone()).await);
    }
    let first = &seen[0];
    assert_eq!(first.0, StatusCode::UNAUTHORIZED);
    for (i, other) in seen.iter().enumerate().skip(1) {
        assert_eq!(other, first, "rejection {i} is distinguishable from the first");
    }
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: PASS, 13 test.

`crates/mcp` juga menyumbang satu peringatan `dead_code` yang diketahui sejak Task 7:
`INVALID_PARAMS` belum punya pemakai sampai Task 9 memakainya untuk argumen tool yang
salah bentuk. Sama seperti `find_by_hash`, jangan dibungkam dengan `#[allow]` — biarkan
ia hilang sendiri saat pemakainya lahir.

Sekalian jalankan `cargo clippy -p transport --all-targets` dan pastikan peringatan
`find_by_hash is never used` **sudah hilang**. Sejak Task 3 peringatan itu menandai
jalur PAT yang belum tersambung; lenyapnya adalah bukti mekanis bahwa `pat.rs` benar-benar
memanggilnya, bukan sekadar mengimpornya.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/mcp apps/backend-rs/crates/transport/src
git commit -m "feat(mcp): authenticate the MCP endpoint with personal access tokens"
```

---

## Task 9: Registry tool + `tools/list` + `tools/call`

**Files:**
- Create: `apps/backend-rs/crates/mcp/src/tools/mod.rs`
- Modify: `apps/backend-rs/crates/mcp/src/lib.rs`, `apps/backend-rs/crates/mcp/tests/mcp_flow.rs`

- [ ] **Step 1: Tambahkan test yang gagal**

Tambahkan di `mcp_flow.rs` sebuah helper untuk menerbitkan PAT langsung ke store, lalu test-nya:

```rust
/// Issue a PAT for a user directly through the store — its RPC path is
/// already tested separately in `transport::tokens_flow`.
async fn issue_token(store: &persistence::Store, user_id: &str) -> String {
    use domain::token::{generate_token, hash_token, preview_of, TokenInfo, TokenOwner, TokenSecret, TokenUsage};
    let t = generate_token();
    store
        .create((
            TokenSecret { hash: hash_token(&t), preview: preview_of(&t) },
            TokenOwner { user_id: user_id.to_string() },
            TokenInfo {
                name: "test".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                expires_at: None,
            },
            TokenUsage { last_used_at: None },
        ))
        .await
        .unwrap();
    t
}

#[tokio::test]
async fn tools_list_returns_the_registry() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;

    let (st, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body:?}");
    let tools = body["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 12);
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"create_task"));
    assert!(!names.contains(&"delete_task"), "delete sengaja tidak diekspos");
    for t in tools {
        assert!(t["description"].as_str().is_some_and(|d| !d.is_empty()));
        assert_eq!(t["inputSchema"]["type"], "object");
    }
}

#[tokio::test]
async fn calling_an_unknown_tool_is_invalid_params() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": { "name": "nope", "arguments": {} } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602);
}

#[tokio::test]
async fn business_failure_is_an_error_result_not_a_protocol_error() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (st, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call",
                "params": { "name": "get_task", "arguments": { "task_id": "999999999" } } }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(body.get("error").is_none(), "bukan error protokol");
    assert_eq!(body["result"]["isError"], true);
    assert!(body["result"]["content"][0]["text"].as_str().is_some());
}
```

`router_and_store()` sudah ada sejak Task 7. Tambahkan helper penyemai user aktif:

```rust
/// A minimal active user — `auth_user_for` rejects anything that isn't `active`.
async fn seed_active_user(store: &persistence::Store) -> String {
    use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
    let uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let pid = store
        .create((
            UserPhone { value: format!("62{uniq}"), verified: true },
            UserPassword { hash: "x".into(), changed_at: "2026-01-01T00:00:00Z".into() },
            UserProfile {
                display_name: "MCP Tester".into(),
                avatar_url: String::new(),
                email: String::new(),
            },
            UserStatusComponent {
                status: "active".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                last_login_at: None,
            },
        ))
        .await
        .unwrap();
    pid.to_string()
}
```

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: FAIL — `tools/list` belum ada.

- [ ] **Step 2: Tulis registry-nya**

`apps/backend-rs/crates/mcp/src/tools/mod.rs`:

```rust
//! MCP tool registry: metadata for `tools/list` and dispatch for
//! `tools/call`.
//!
//! Every tool calls the same core fn as the Connect handler (`transport::api`),
//! so member-gating, validation, activity recording, notifications, and search
//! indexing all come along without duplicated rules.

pub mod comments;
pub mod discovery;
pub mod projects;
pub mod tasks;

use std::sync::Arc;

use auth::AuthUser;
use connectrpc_axum::{Code, ConnectError};
use persistence::Store;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use transport::Notifier;

/// What a tool needs in order to run.
pub struct Ctx {
    pub store: Arc<Store>,
    pub notifier: Arc<Notifier>,
    pub auth: AuthUser,
}

pub enum ToolError {
    /// The request is well-formed but rejected by a business rule → tool
    /// result `isError`, since the model can read the reason and retry
    /// correctly.
    Business(String),
    /// The arguments themselves are malformed → a JSON-RPC protocol error.
    BadArgs(String),
    /// The tool could not run at all. Rephrasing the call will not help, and
    /// the detail belongs in our logs rather than in a third-party AI client:
    /// these messages are raw database and IO errors.
    Internal(String),
}

impl From<ConnectError> for ToolError {
    fn from(e: ConnectError) -> Self {
        // `message()` is the sentence the handler wrote for a human; the code
        // is used only when the handler didn't include a message.
        let text = e.message().unwrap_or(e.code().as_str()).to_string();
        // Folding an infrastructure fault in with the business codes hands a
        // model a raw database error and invites it to "read the reason and
        // retry correctly" — which is not something it can do about a dropped
        // connection, and that text is not ours to give a third-party client.
        match e.code() {
            Code::Internal | Code::Unavailable | Code::Unknown | Code::DataLoss => {
                ToolError::Internal(text)
            }
            _ => ToolError::Business(text),
        }
    }
}

/// A tool's handler, boxed so `ToolMeta` can hold one in a `const`.
pub type Handler = for<'a> fn(
    &'a Ctx,
    &'a Value,
) -> Pin<Box<dyn Future<Output = Result<Value, ToolError>> + Send + 'a>>;

/// Everything the protocol needs both to advertise a tool and to run it.
///
/// The handler lives here rather than in a separate dispatch table on purpose.
/// Two hand-maintained lists keyed by tool name eventually disagree, and the
/// failure is silent in both directions: a tool advertised but not dispatchable
/// fails every call with "unknown tool", and one dispatchable but unlisted is
/// callable yet undiscoverable. With a single list neither is expressible.
pub struct ToolMeta {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: fn() -> Value,
    pub handler: Handler,
}

pub const TOOLS: &[ToolMeta] = &[
    tasks::LIST_TASKS,
    tasks::GET_TASK,
    tasks::CREATE_TASK,
    tasks::UPDATE_TASK,
    tasks::MOVE_TASK,
    projects::LIST_PROJECTS,
    projects::GET_PROJECT,
    projects::LIST_MODULES,
    discovery::SEARCH,
    discovery::MY_TASKS,
    comments::LIST_COMMENTS,
    comments::ADD_COMMENT,
];

pub fn tool_list() -> Value {
    json!({
        "tools": TOOLS
            .iter()
            .map(|t| json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": (t.schema)(),
            }))
            .collect::<Vec<_>>()
    })
}

/// Run one tool. `BadArgs` becomes a JSON-RPC error, `Business` an `isError`
/// tool result, and `Internal` is logged and answered generically.
pub async fn dispatch(ctx: &Ctx, name: &str, args: &Value) -> Result<Value, ToolError> {
    match TOOLS.iter().find(|t| t.name == name) {
        Some(tool) => (tool.handler)(ctx, args).await,
        None => Err(ToolError::BadArgs(format!("unknown tool: {name}"))),
    }
}

/// Tool result → MCP `content`. We send JSON inside a single text block:
/// every client renders `text`, while the JSON structure stays readable by
/// the model.
pub fn ok_content(value: Value) -> Value {
    json!({
        // Compact, not pretty: the caps above exist to protect the client's
        // context window, and indentation spends tokens on the largest
        // payloads for something no model needs in order to parse JSON.
        "content": [{ "type": "text", "text": serde_json::to_string(&value).unwrap_or_default() }],
        "isError": false
    })
}

pub fn error_content(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

// --- Argument helpers, used across every tool module ---

pub fn str_arg(args: &Value, key: &str) -> Result<String, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ToolError::BadArgs(format!("`{key}` is required and must be a string")))
}

pub fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Absent means "not supplied". A wrong-typed value is refused rather than read
/// as absent: id arrays are the argument a client is most likely to get wrong,
/// and silently dropping a bad element would assign a task to fewer people than
/// the model asked for and then report success.
pub fn opt_str_list(args: &Value, key: &str) -> Result<Option<Vec<String>>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_str().map(str::to_string).ok_or_else(|| {
                    ToolError::BadArgs(format!("every element of `{key}` must be a string"))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(ToolError::BadArgs(format!(
            "`{key}` must be an array of strings"
        ))),
    }
}

/// A capped `limit`: default 50, maximum 200. This bound is what keeps a
/// single tool call from swallowing the client's entire context.
pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 200;

/// Absent means "use the default". Present-but-unusable is a caller bug and is
/// refused rather than silently clamped: quietly turning `limit: 0` into 1, or
/// `limit: -5` into 50, teaches the model nothing about why it did not get what
/// it asked for.
pub fn limit_arg(args: &Value) -> Result<usize, ToolError> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(DEFAULT_LIMIT),
        Some(v) => v
            .as_u64()
            .filter(|n| (1..=MAX_LIMIT as u64).contains(n))
            .map(|n| n as usize)
            .ok_or_else(|| {
                ToolError::BadArgs(format!(
                    "`limit` must be a whole number between 1 and {MAX_LIMIT}"
                ))
            }),
    }
}

/// Long descriptions are truncated before being sent to the model.
pub const MAX_DESCRIPTION: usize = 2000;

pub fn truncate(s: &str) -> String {
    if s.chars().count() <= MAX_DESCRIPTION {
        return s.to_string();
    }
    let head: String = s.chars().take(MAX_DESCRIPTION).collect();
    format!("{head}… [truncated; open the task in the portal for the full text]")
}
```

- [ ] **Step 3: Sambungkan ke dispatch protokol**

Di `crates/mcp/src/lib.rs`, tambahkan `mod tools;` dan lengkapi `match` di `handle_post`:

```rust
        "tools/list" => result(rpc.id.clone(), tools::tool_list()),
        "tools/call" => {
            let name = rpc.params.get("name").and_then(Value::as_str).unwrap_or_default();
            let args = rpc.params.get("arguments").cloned().unwrap_or(Value::Object(Default::default()));
            let ctx = tools::Ctx {
                store: state.store.clone(),
                notifier: state.notifier.clone(),
                // Not `.expect()`: that would tie a panic on a live request path to
                // `needs_auth`'s exclusion list staying correct by convention. If the
                // two ever drift, answer honestly instead of dying.
                auth: match auth {
                    Some(u) => u,
                    None => {
                        return unauthorized(rpc.id);
                    }
                },
            };
            match tools::dispatch(&ctx, name, &args).await {
                Ok(v) => result(rpc.id.clone(), tools::ok_content(v)),
                Err(tools::ToolError::Business(m)) => {
                    result(rpc.id.clone(), tools::error_content(&m))
                }
                Err(tools::ToolError::BadArgs(m)) => {
                    error(rpc.id.clone(), INVALID_PARAMS, &m)
                }
                // The detail goes to the log, not to the client: it is a raw
                // database or IO error, and the model can do nothing with it.
                Err(tools::ToolError::Internal(m)) => {
                    tracing::error!(tool = name, error = %m, "mcp: tool failed");
                    error(
                        rpc.id.clone(),
                        INTERNAL_ERROR,
                        "the tool could not be completed",
                    )
                }
            }
        }
```

Impor `INVALID_PARAMS` dan `INTERNAL_ERROR` dari `protocol`.

- [ ] **Step 4: Buat empat modul tool sebagai stub**

Supaya task ini berdiri sendiri, buat `tools/tasks.rs`, `tools/projects.rs`,
`tools/discovery.rs`, dan `tools/comments.rs` lebih dulu berisi stub yang bisa
dikompilasi — satu `ToolMeta` per tool dengan schema minimal, dan handler yang
mengembalikan `Business`. Task 10–13 menggantinya satu per satu. Pola stub-nya,
diulang untuk kedua belas nama tool di `TOOLS`:

```rust
use serde_json::{json, Value};
use super::{Ctx, ToolError, ToolMeta};

pub const LIST_TASKS: ToolMeta = ToolMeta {
    name: "list_tasks",
    description: "List tasks in a project or module.",
    schema: || json!({ "type": "object", "properties": {} }),
    handler: |ctx, args| Box::pin(list_tasks(ctx, args)),
};

pub async fn list_tasks(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}
```

- [ ] **Step 5: Jalankan test**

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: PASS untuk `tools_list_returns_the_registry` dan
`calling_an_unknown_tool_is_invalid_params`. Test
`business_failure_is_an_error_result_not_a_protocol_error` juga lulus — stub
mengembalikan `Business`, yang persis bentuk yang diuji.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/mcp
git commit -m "feat(mcp): add tool registry, tools/list, and tools/call dispatch"
```

---

## Task 10: Tool task

**Files:**
- Create: `apps/backend-rs/crates/mcp/src/tools/tasks.rs`

- [ ] **Step 1: Tulis kelima tool**

`apps/backend-rs/crates/mcp/src/tools/tasks.rs`:

```rust
//! Task tools. Every tool calls the same core fn as the UI, then flattens the
//! proto result into model-friendly JSON — enums become strings, and long
//! descriptions are truncated.

use serde_json::{json, Value};
use transport::api::{
    create_task_core, get_task_core, list_tasks_core, move_task_core, update_task_core,
};

use super::{limit_arg, opt_str, opt_str_list, str_arg, truncate, Ctx, ToolError, ToolMeta};

/// Proto Task → flat JSON. `snake_case` field names to match the tool
/// argument names; the model doesn't need to translate between two
/// conventions.
pub(crate) fn flatten(t: &transport::api::work_pb::Task) -> Value {
    json!({
        "id": t.id,
        "title": t.title,
        "description": truncate(&t.description),
        "status": t.status_label(),
        "priority": t.priority_label(),
        "module_id": t.module_id,
        "assignee_ids": t.assignee_ids,
        "start_date": t.start_date,
        "due_date": t.due_date,
        "parent_id": t.parent_id,
    })
}
```

Bentuk `flatten` di atas bergantung pada tipe proto yang sebenarnya. Sebelum menulisnya, jalankan `cargo doc -p transport --open` atau baca `proto/work.proto`, lalu:

1. Tambahkan di `crates/transport/src/api.rs` sebuah re-export tipe proto yang dibutuhkan crate `mcp`, misalnya:

```rust
pub use crate::sedjiwa::tasks::work::v1 as work_pb;
pub use crate::sedjiwa::tasks::project::v1 as project_pb;
pub use crate::sedjiwa::tasks::comment::v1 as comment_pb;
pub use crate::sedjiwa::tasks::search::v1 as search_pb;
pub use crate::sedjiwa::tasks::dashboard::v1 as dashboard_pb;
```

(sesuaikan nama package dengan `package …` di tiap proto).

2. Untuk `status` dan `priority`, ubah angka enum menjadi label yang dibaca model dengan helper domain yang sudah ada:

```rust
pub(crate) fn status_label(v: i32) -> &'static str {
    domain::task::TaskStatus::from_proto(v)
        .unwrap_or(domain::task::TaskStatus::Todo)
        .as_str()
}
fn priority_label(v: i32) -> &'static str {
    domain::task::TaskPriority::from_proto(v)
        .unwrap_or(domain::task::TaskPriority::None)
        .as_str()
}
```

Lalu `flatten` memakai `status_label(t.status)` dan `priority_label(t.priority)`.

- [ ] **Step 2: Definisikan metadata dan handler**

Lanjutkan file yang sama:

```rust
pub const LIST_TASKS: ToolMeta = ToolMeta {
    name: "list_tasks",
    description: "List tasks in a project or module. Either project_id or \
                  module_id is required. Use list_projects first if you don't \
                  know the id yet.",
    schema: || json!({
        "type": "object",
        "properties": {
            "project_id": { "type": "string" },
            "module_id": { "type": "string" },
            "assignee_id": { "type": "string" },
            "status": { "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] },
            "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
        }
    }),
    handler: |ctx, args| Box::pin(list_tasks(ctx, args)),
};

pub async fn list_tasks(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let project_id = opt_str(args, "project_id");
    let module_id = opt_str(args, "module_id");
    // Without one of these, this request would scan the entire database.
    if project_id.is_none() && module_id.is_none() {
        return Err(ToolError::BadArgs(
            "either `project_id` or `module_id` is required".into(),
        ));
    }
    let req = transport::api::work_pb::ListTasksRequest {
        project_id: project_id.unwrap_or_default(),
        module_id: module_id.clone(),
    };
    let resp = list_tasks_core(&ctx.store, &ctx.auth, req).await?;
    let status = opt_str(args, "status");
    let assignee = opt_str(args, "assignee_id");
    let rows: Vec<Value> = resp
        .tasks
        .iter()
        .filter(|t| status.as_deref().is_none_or(|s| status_label(t.status) == s))
        .filter(|t| assignee.as_deref().is_none_or(|a| t.assignee_ids.iter().any(|x| x == a)))
        .take(limit_arg(args)?)
        .map(flatten)
        .collect();
    Ok(json!({ "tasks": rows, "count": rows.len() }))
}
```

Bila `ListTasksRequest` mewajibkan `project_id` sementara pemanggil hanya memberi `module_id`, resolusikan project-nya lebih dulu lewat `get_task`/`list_modules` sesuai bentuk proto yang sebenarnya — jangan mengubah core fn-nya.

Tulis empat sisanya dengan pola yang sama:

```rust
pub const GET_TASK: ToolMeta = ToolMeta {
    name: "get_task",
    description: "Fetch a single task with its description, assignees, dates, and status.",
    schema: || json!({
        "type": "object",
        "properties": { "task_id": { "type": "string" } },
        "required": ["task_id"]
    }),
    handler: |ctx, args| Box::pin(get_task(ctx, args)),
};

pub async fn get_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = transport::api::work_pb::GetTaskRequest { id: str_arg(args, "task_id")? };
    Ok(flatten(&get_task_core(&ctx.store, &ctx.auth, req).await?))
}

pub const CREATE_TASK: ToolMeta = ToolMeta {
    name: "create_task",
    description: "Create a new task in a module. Assignees must be project members.",
    schema: || json!({
        "type": "object",
        "properties": {
            "module_id": { "type": "string" },
            "title": { "type": "string" },
            "description": { "type": "string" },
            "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
            "start_date": { "type": "string", "description": "RFC3339" },
            "due_date": { "type": "string", "description": "RFC3339" },
            "assignee_ids": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["module_id", "title"]
    }),
    handler: |ctx, args| Box::pin(create_task(ctx, args)),
};

pub async fn create_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = transport::api::work_pb::CreateTaskRequest {
        module_id: str_arg(args, "module_id")?,
        title: str_arg(args, "title")?,
        description: opt_str(args, "description"),
        status: 0,
        priority: priority_value(opt_str(args, "priority").as_deref()),
        start_date: opt_str(args, "start_date"),
        due_date: opt_str(args, "due_date"),
        assignee_ids: opt_str_list(args, "assignee_ids")?.unwrap_or_default(),
        label_ids: Vec::new(),
        parent_id: opt_str(args, "parent_id"),
    };
    let t = create_task_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(flatten(&t))
}

pub const UPDATE_TASK: ToolMeta = ToolMeta {
    name: "update_task",
    description: "Update a subset of a task's fields. Fields not sent are left as-is.",
    schema: || json!({
        "type": "object",
        "properties": {
            "task_id": { "type": "string" },
            "title": { "type": "string" },
            "description": { "type": "string" },
            "status": { "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] },
            "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
            "start_date": { "type": "string" },
            "due_date": { "type": "string" },
            "assignee_ids": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["task_id"]
    }),
    handler: |ctx, args| Box::pin(update_task(ctx, args)),
};

pub const MOVE_TASK: ToolMeta = ToolMeta {
    name: "move_task",
    description: "Move a task to another module in the same project.",
    schema: || json!({
        "type": "object",
        "properties": { "task_id": { "type": "string" }, "module_id": { "type": "string" } },
        "required": ["task_id", "module_id"]
    }),
    handler: |ctx, args| Box::pin(move_task(ctx, args)),
};
```

`update_task` dan `move_task` mengikuti bentuk `get_task`: bangun request proto dari argumen, panggil core fn (`update_task_core` meneruskan `Some(&ctx.notifier)`), lalu kembalikan `flatten(&t)`. `priority_value` adalah kebalikan `priority_label` — pakai `domain::task::TaskPriority::parse(..).map(|p| p.to_proto()).unwrap_or(0)`; kalau `parse` tidak ada, tambahkan di `domain::task` bersama unit test-nya, sejajar dengan `TaskStatus::parse`.

- [ ] **Step 2b: Sesuaikan nama field**

Nama field pada `CreateTaskRequest`/`UpdateTaskRequest` di atas mengikuti `proto/work.proto`. Buka file itu dan samakan persis — `Option<String>` untuk field `optional`, `String` untuk yang biasa.

- [ ] **Step 3: Tulis test tool task**

Tambahkan di `crates/mcp/tests/mcp_flow.rs`:

```rust
#[tokio::test]
async fn create_then_get_a_task_through_mcp() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    // Project + module are seeded through the transport core fn so the same
    // membership rules apply; see the `seed_project_and_module` helper below.
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 10, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": { "module_id": module_id, "title": "dari MCP" } } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["title"], "dari MCP");
    let task_id = payload["id"].as_str().unwrap().to_string();

    let (_, fetched) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 11, "method": "tools/call",
                "params": { "name": "get_task", "arguments": { "task_id": task_id } } }),
    )
    .await;
    let payload: Value =
        serde_json::from_str(fetched["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["title"], "dari MCP");
    assert_eq!(payload["status"], "todo");
}

/// A project (owned by `user`, with `user` as a member) + one module inside
/// it. Seeded directly through components rather than RPC: the project
/// creation flow is already tested in `transport::project_flow`, and this
/// test only needs data that makes the membership check pass.
///
/// A project owned by `user` (with `user` as a member) plus one module inside it.
/// Seeded straight through components rather than over RPC: project creation is
/// already covered by `transport::project_flow`, and this test only needs data
/// that makes the membership check pass.
///
/// Returns `(project_id, module_id)`.
async fn seed_project_and_module(store: &persistence::Store, user: &str) -> (String, String) {
    use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
    use domain::project::{
        ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
        ProjectStatus, ProjectStatusComponent,
    };
    let project = store
        .create((
            ProjectName { value: "MCP test project".into() },
            ProjectDescription { value: String::new() },
            ProjectOwnerId { value: user.to_string() },
            ProjectStatusComponent { value: ProjectStatus::Active.as_str().to_string() },
            ProjectDates { start_date: None, end_date: None },
        ))
        .await
        .unwrap();
    let project_id = project.to_string();
    // Membership is its own entity, one row per (project, user) — creating a
    // project does not make its owner a member.
    store
        .create((ProjectMembership {
            project_id: project_id.clone(),
            user_id: user.to_string(),
        },))
        .await
        .unwrap();
    let module = store
        .create((
            ModuleName { value: "Backlog".into() },
            ModuleDescription { value: String::new() },
            ModuleProjectRef { project_id: project_id.clone() },
            ModuleOrder { value: 0 },
        ))
        .await
        .unwrap();
    (project_id, module.to_string())
}
```

Bentuk komponen di atas sudah diverifikasi terhadap `crates/domain/src/project.rs` dan
`crates/domain/src/module.rs` saat Task 10, jadi tidak perlu ditebak lagi.

- [ ] **Step 4: Jalankan test**

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: PASS (test tool task + seluruh test Task 7–9).

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/mcp
git commit -m "feat(mcp): implement the task tools"
```

---

## Task 11: Tool project & module

**Files:**
- Create: `apps/backend-rs/crates/mcp/src/tools/projects.rs`

- [ ] **Step 1: Tulis ketiga tool**

```rust
//! Navigation tools: project and module. These are what the model uses to
//! find an id before touching a task — without them, `create_task` has no
//! `module_id`.

use serde_json::{json, Value};
use transport::api::{get_project_core, list_modules_core, list_projects_core, project_pb, work_pb};

use super::{limit_arg, str_arg, truncate, Ctx, ToolError, ToolMeta};

pub const LIST_PROJECTS: ToolMeta = ToolMeta {
    name: "list_projects",
    description: "List projects the user can access. Start here if you don't know the project id.",
    schema: || json!({
        "type": "object",
        "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 200 } }
    }),
    handler: |ctx, args| Box::pin(list_projects(ctx, args)),
};

pub async fn list_projects(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let resp = list_projects_core(&ctx.store, &ctx.auth, project_pb::ListProjectsRequest::default())
        .await?;
    let rows: Vec<Value> = resp
        .projects
        .iter()
        .take(limit_arg(args)?)
        .map(|p| json!({ "id": p.id, "name": p.name, "status": p.status }))
        .collect();
    Ok(json!({ "projects": rows, "count": rows.len() }))
}

pub const GET_PROJECT: ToolMeta = ToolMeta {
    name: "get_project",
    description: "Details for a single project: description, status, dates, and owner.",
    schema: || json!({
        "type": "object",
        "properties": { "project_id": { "type": "string" } },
        "required": ["project_id"]
    }),
    handler: |ctx, args| Box::pin(get_project(ctx, args)),
};

pub async fn get_project(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = project_pb::GetProjectRequest { id: str_arg(args, "project_id")? };
    let p = get_project_core(&ctx.store, &ctx.auth, req).await?;
    Ok(json!({
        "id": p.id,
        "name": p.name,
        "description": truncate(&p.description),
        "status": p.status,
        "owner_id": p.owner_id,
    }))
}

pub const LIST_MODULES: ToolMeta = ToolMeta {
    name: "list_modules",
    description: "Modules (task groups) in a project. `create_task` needs module_id, not project_id.",
    schema: || json!({
        "type": "object",
        "properties": { "project_id": { "type": "string" } },
        "required": ["project_id"]
    }),
    handler: |ctx, args| Box::pin(list_modules(ctx, args)),
};

pub async fn list_modules(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = work_pb::ListModulesRequest { project_id: str_arg(args, "project_id")? };
    let resp = list_modules_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .modules
        .iter()
        .map(|m| json!({ "id": m.id, "name": m.name, "project_id": m.project_id }))
        .collect();
    Ok(json!({ "modules": rows, "count": rows.len() }))
}
```

Samakan nama field (`p.status`, `p.owner_id`, `m.project_id`, dan bentuk `ListProjectsRequest`) dengan `proto/projects.proto` dan `proto/work.proto`. Bila `status` di proto berupa enum numerik, ubah ke label lewat helper `domain::project` yang setara dengan `TaskStatus::as_str`.

- [ ] **Step 2: Uji lewat MCP**

Tambahkan di `crates/mcp/tests/mcp_flow.rs`:

```rust
#[tokio::test]
async fn list_projects_only_shows_projects_the_user_can_see() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    let stranger = seed_active_user(&store).await;
    let (project_id, _module_id) = seed_project_and_module(&store, &member).await;

    let (_, mine) = tools_call(&router, &issue_token(&store, &member).await, "list_projects", json!({})).await;
    assert!(mine["projects"].as_array().unwrap().iter().any(|p| p["id"] == project_id.as_str()));

    let (_, theirs) = tools_call(&router, &issue_token(&store, &stranger).await, "list_projects", json!({})).await;
    assert!(theirs["projects"].as_array().unwrap().iter().all(|p| p["id"] != project_id.as_str()));
}
```

Tambahkan helper `tools_call` yang membungkus `rpc` dan langsung mem-parse payload JSON di dalam `content[0].text`:

```rust
/// Call a single tool and return (isError, the parsed JSON payload).
async fn tools_call(router: &Router, token: &str, name: &str, arguments: Value) -> (bool, Value) {
    let (_, body) = rpc(
        router,
        Some(token),
        json!({ "jsonrpc": "2.0", "id": 99, "method": "tools/call",
                "params": { "name": name, "arguments": arguments } }),
    )
    .await;
    let is_error = body["result"]["isError"].as_bool().unwrap_or(true);
    let text = body["result"]["content"][0]["text"].as_str().unwrap_or("null");
    (is_error, serde_json::from_str(text).unwrap_or(Value::Null))
}
```

- [ ] **Step 3: Jalankan test dan commit**

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: PASS.

```bash
git add apps/backend-rs/crates/mcp
git commit -m "feat(mcp): add project and module tools"
```

---

## Task 12: Tool `search` dan `my_tasks`

**Files:**
- Create: `apps/backend-rs/crates/mcp/src/tools/discovery.rs`

- [ ] **Step 1: Tulis kedua tool**

```rust
//! Discovery tools: cross-entity search and "what's on my plate". Both are
//! read-only and cross-project, so both rely entirely on the membership
//! filter inside their core fn.

use serde_json::{json, Value};
use transport::api::{
    dashboard_pb, list_assigned_to_me_core, list_created_by_me_core, list_involving_me_core,
    search_core, search_pb,
};

use super::{limit_arg, str_arg, truncate, Ctx, ToolError, ToolMeta};

pub const SEARCH: ToolMeta = ToolMeta {
    name: "search",
    description: "Search tasks, projects, pages, and comments by keyword. \
                  Use this when the user refers to something by name rather than id.",
    schema: || json!({
        "type": "object",
        "properties": {
            "q": { "type": "string" },
            // 50, not 200: `search_core` hard-caps there, and a schema that
            // promises a ceiling the server will not honour is worse than none —
            // the model asks for 200, receives 50, and is told nothing.
            "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
        },
        "required": ["query"]
    }),
    handler: |ctx, args| Box::pin(search(ctx, args)),
};

pub async fn search(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = search_pb::SearchRequest {
        query: str_arg(args, "query")?,
        ..Default::default()
    };
    let resp = search_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .results
        .iter()
        .take(limit_arg(args)?)
        .map(|r| json!({
            "kind": r.kind,
            "id": r.entity_id,
            "title": r.title,
            "snippet": truncate(&r.snippet),
            "project_id": r.project_id,
        }))
        .collect();
    Ok(json!({ "results": rows, "count": rows.len() }))
}

pub const MY_TASKS: ToolMeta = ToolMeta {
    name: "my_tasks",
    description: "Tasks this user is connected to, across every project. `scope` picks \
                  the connection: `assigned` (the default, and the answer to 'what \
                  should I work on'), `created` for tasks they opened, or `involving` \
                  for tasks they commented on or were mentioned in. `involving` is \
                  about discussion, not ownership — it does not include tasks merely \
                  assigned to them.",
    schema: || json!({
        "type": "object",
        "properties": {
            "scope": {
                "type": "string",
                "enum": ["assigned", "created", "involving"],
                "description": "assigned (default) | created | involving \
                                (commented on or mentioned in)"
            },
            "status": { "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] },
            "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
        }
    }),
    handler: |ctx, args| Box::pin(my_tasks(ctx, args)),
};

pub async fn my_tasks(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    // MyTasksService is three RPCs, not one, and they differ only in which
    // relationship to the user they filter on. Exposing three near-identical
    // tools would spend the model's attention on a distinction one enum argument
    // already makes; `assigned` is the default because it answers the question
    // people actually ask.
    let req = dashboard_pb::MyTasksRequest::default();
    let resp = match super::opt_str(args, "scope").as_deref().unwrap_or("assigned") {
        "assigned" => list_assigned_to_me_core(&ctx.store, &ctx.auth, req).await?,
        "created" => list_created_by_me_core(&ctx.store, &ctx.auth, req).await?,
        "involving" => list_involving_me_core(&ctx.store, &ctx.auth, req).await?,
        other => {
            return Err(ToolError::BadArgs(format!(
                "unknown scope `{other}`: expected assigned, created, or involving"
            )))
        }
    };
    let want = super::opt_str(args, "status");
    // `MyTasksResponse` is `{ items: [MyTask], total }`, and each `MyTask` wraps a
    // `Task` with the project and module names — context the model would
    // otherwise need a second call to `get_project` to recover.
    let rows: Vec<Value> = resp
        .items
        .iter()
        .filter_map(|m| m.task.as_ref().map(|t| (m, t)))
        .filter(|(_, t)| want.as_deref().is_none_or(|s| super::tasks::status_label(t.status) == s))
        .take(limit_arg(args)?)
        .map(|(m, t)| {
            let mut row = super::tasks::flatten(t);
            row["project_id"] = json!(m.project_id);
            row["project_name"] = json!(m.project_name);
            row["module_name"] = json!(m.module_name);
            row
        })
        .collect();
    Ok(json!({ "tasks": rows, "count": rows.len(), "total": resp.total }))
}
```

Agar `my_tasks` bisa memakainya, ubah `flatten` dan `status_label` di `tools/tasks.rs` menjadi `pub(crate)`. Samakan nama field hasil pencarian (`r.kind`, `r.entity_id`, `r.snippet`) dengan `proto/search.proto`. Bentuk `MyTasksResponse` sudah dipastikan saat Task 6 dan tidak perlu ditebak lagi: `{ items: [MyTask], total: u32 }`, dengan `MyTask { task, project_id, project_name, module_name }` — daftar datar, bukan pengelompokan. `task` bertipe `Option`, jadi baris tanpa task dilewati, bukan di-`unwrap`.

- [ ] **Step 2: Uji dan commit**

Tambahkan di `mcp_flow.rs`:

```rust
#[tokio::test]
async fn my_tasks_returns_only_assigned_work() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (err, _) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "punya saya", "assignee_ids": [user.clone()] })).await;
    assert!(!err);
    let (err, _) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "tanpa assignee" })).await;
    assert!(!err);

    let (err, mine) = tools_call(&router, &token, "my_tasks", json!({})).await;
    assert!(!err);
    let titles: Vec<&str> = mine["tasks"].as_array().unwrap()
        .iter().map(|t| t["title"].as_str().unwrap()).collect();
    assert!(titles.contains(&"punya saya"));
    assert!(!titles.contains(&"tanpa assignee"));
}
```

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: PASS.

```bash
git add apps/backend-rs/crates/mcp
git commit -m "feat(mcp): add search and my-tasks tools"
```

---

## Task 13: Tool komentar

**Files:**
- Create: `apps/backend-rs/crates/mcp/src/tools/comments.rs`

- [ ] **Step 1: Tulis kedua tool**

```rust
//! Comment tools. `add_comment` forwards the Notifier: a comment written by
//! the AI triggers a mention notification exactly like one typed by a human.

use serde_json::{json, Value};
use transport::api::{comment_pb, create_comment_core, list_comments_core};

use super::{limit_arg, str_arg, truncate, Ctx, ToolError, ToolMeta};

pub const LIST_COMMENTS: ToolMeta = ToolMeta {
    name: "list_comments",
    description: "Discussion on a task, oldest first.",
    schema: || json!({
        "type": "object",
        "properties": {
            "task_id": { "type": "string" },
            "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
        },
        "required": ["task_id"]
    }),
    handler: |ctx, args| Box::pin(list_comments(ctx, args)),
};

pub async fn list_comments(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = comment_pb::ListCommentsRequest {
        task_id: str_arg(args, "task_id")?,
        page: 1,
        page_size: limit_arg(args)? as u32,
    };
    let resp = list_comments_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .comments
        .iter()
        .map(|c| json!({
            "id": c.id,
            "author_id": c.author_id,
            "content": truncate(&c.content),
            "created_at": c.created_at,
        }))
        .collect();
    Ok(json!({ "comments": rows, "count": rows.len() }))
}

pub const ADD_COMMENT: ToolMeta = ToolMeta {
    name: "add_comment",
    description: "Post a comment on a task, on behalf of the token's owner.",
    schema: || json!({
        "type": "object",
        "properties": {
            "task_id": { "type": "string" },
            "content": { "type": "string" }
        },
        "required": ["task_id", "content"]
    }),
    handler: |ctx, args| Box::pin(add_comment(ctx, args)),
};

pub async fn add_comment(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = comment_pb::CreateCommentRequest {
        task_id: str_arg(args, "task_id")?,
        content: str_arg(args, "content")?,
        ..Default::default()
    };
    let c = create_comment_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(json!({ "id": c.id, "task_id": c.task_id, "created_at": c.created_at }))
}
```

- [ ] **Step 2: Uji dan commit**

```rust
#[tokio::test]
async fn add_then_list_comments() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_p, module_id) = seed_project_and_module(&store, &user).await;
    let (_, task) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "berkomentar" })).await;
    let task_id = task["id"].as_str().unwrap().to_string();

    let (err, _) = tools_call(&router, &token, "add_comment",
        json!({ "task_id": task_id, "content": "laporan dari AI" })).await;
    assert!(!err);

    let (err, listed) = tools_call(&router, &token, "list_comments", json!({ "task_id": task_id })).await;
    assert!(!err);
    assert_eq!(listed["comments"][0]["content"], "laporan dari AI");
    assert_eq!(listed["comments"][0]["author_id"], user.as_str());
}
```

Run: `DATABASE_URL=$DATABASE_URL cargo test -p mcp`
Expected: PASS, dan `tools_list_returns_the_registry` sekarang benar-benar melihat 12 tool.

```bash
git add apps/backend-rs/crates/mcp
git commit -m "feat(mcp): add comment tools"
```

---

## Task 14: Pasang endpoint di aplikasi

**Files:**
- Modify: `apps/backend-rs/crates/app/Cargo.toml`, `apps/backend-rs/crates/app/src/router.rs`

- [ ] **Step 1: Tambah dependency**

Di `apps/backend-rs/crates/app/Cargo.toml`, `[dependencies]`:

```toml
mcp = { path = "../mcp" }
```

- [ ] **Step 2: Pasang di router**

Di `apps/backend-rs/crates/app/src/router.rs`, **jangan** cukup menambahkan `.nest()` di ujung rantai merge yang sudah ada. `.layer()` membungkus seluruh router tempat ia dipanggil, termasuk apa pun yang di-nest di dalamnya — jadi menambahkan MCP di sana justru menaruhnya di dalam `ConnectLayer` dan `auth_layer`, persis kebalikan dari yang dibutuhkan.

Pecah rantainya: kumpulkan seluruh `.merge()` service Connect ke satu variabel, terapkan `ConnectLayer`, `Extension(notifier)`, dan `auth_layer` **hanya** ke subtree itu, lalu nest MCP di luarnya, dan terakhir `cors` untuk keduanya.

```rust
    let connect_api = transport::health_router(store.clone())
        // … seluruh .merge() lainnya seperti sekarang …
        .merge(transport::notification_router(store.clone(), notifier.clone()))
        .layer(ConnectLayer::new())
        .layer(Extension(notifier.clone()))
        .layer(axum::middleware::from_fn_with_state(secret, auth_layer));

    // MCP membawa jalur kredensialnya sendiri (PAT) dan protokolnya sendiri,
    // jadi ia sengaja duduk di luar kedua layer di atas. CORS tetap berlaku
    // untuk keduanya.
    connect_api
        .nest("/mcp", mcp::mcp_router(store, notifier))
        .layer(cors)
```

Endpoint publiknya menjadi `/api/tasks-rs/mcp`: proxy dev di `apps/frontend/vite.config.ts` membuang prefix `/api/tasks-rs` sebelum meneruskan ke backend, sama seperti untuk route Connect.

- [ ] **Step 3: Verifikasi manual**

```bash
cargo run -p app &
curl -s localhost:3010/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

Expected: JSON berisi `"serverInfo":{"name":"sedjiwa-tasks"…}`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3010/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Expected: `401`.

Hentikan servernya dengan mencari pid-nya lebih dulu (`jobs -p`, lalu `kill <pid>`) — jangan `pkill -f` dengan pola yang juga cocok dengan perintah yang sedang diketik.

- [ ] **Step 4: Jalankan seluruh test workspace dan commit**

Run: `DATABASE_URL=$DATABASE_URL cargo test --workspace`
Expected: PASS.

```bash
git add apps/backend-rs/crates/app
git commit -m "feat(app): mount the MCP endpoint at /mcp"
```

---

# Phase 4 — Frontend: manajemen token

## Task 15: Client dan hooks token

**Files:**
- Create: `apps/frontend/src/features/tokens/types.ts`, `.../api/mappers.ts`, `.../api/hooks.ts`, `.../index.ts`
- Generated: `apps/frontend/src/lib/gen/tokens_pb.ts`

Semua perintah di Phase 4 dijalankan dari `apps/frontend/`.

- [ ] **Step 1: Regenerasi client Connect**

Run: `./node_modules/.bin/buf generate`
Expected: `src/lib/gen/tokens_pb.ts` muncul dan mengekspor `AccessTokenService`.

- [ ] **Step 2: Tulis tipe pipih**

`src/features/tokens/types.ts`:

```typescript
/** PAT metadata as shown by the UI. The plaintext is never present here. */
export type AccessToken = {
  id: string;
  name: string;
  /** Last 4 characters — the only plaintext remnant still visible. */
  preview: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  expired: boolean;
};
```

`src/features/tokens/api/mappers.ts`:

```typescript
import type { AccessToken as AccessTokenProto } from "@/lib/gen/tokens_pb";
import type { AccessToken } from "../types";

export function mapToken(t: AccessTokenProto): AccessToken {
  return {
    id: t.id,
    name: t.name,
    preview: t.preview,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt ?? null,
    lastUsedAt: t.lastUsedAt ?? null,
    expired: t.expired,
  };
}
```

- [ ] **Step 3: Tulis hooks**

`src/features/tokens/api/hooks.ts`:

```typescript
// Personal access token RPC hooks (connect-query over AccessTokenService).
// Entirely self-scoped on the server, so there's no owner parameter here.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { AccessTokenService } from "@/lib/gen/tokens_pb";
import { queryClient } from "@/lib/query";
import type { AccessToken } from "../types";
import { mapToken } from "./mappers";

function invalidateTokens() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: AccessTokenService,
      cardinality: "finite",
    }),
  });
}

export function useTokens() {
  const result = useQuery(AccessTokenService.method.listTokens, {});
  const tokens: AccessToken[] = (result.data?.tokens ?? []).map(mapToken);
  return { ...result, tokens };
}

export function useCreateToken() {
  return useMutation(AccessTokenService.method.createToken, {
    onSuccess: invalidateTokens,
  });
}

export function useRevokeToken() {
  return useMutation(AccessTokenService.method.revokeToken, {
    onSuccess: invalidateTokens,
  });
}
```

- [ ] **Step 4: Barrel**

`src/features/tokens/index.ts`:

```typescript
// Tokens feature barrel.

export type { AccessToken } from "./types";
export { mapToken } from "./api/mappers";
export { useTokens, useCreateToken, useRevokeToken } from "./api/hooks";
```

- [ ] **Step 5: Verifikasi dan commit**

Run: `bun run tsc --noEmit && bun run lint`
Expected: bersih.

```bash
git add apps/frontend/src/features/tokens apps/frontend/src/lib/gen/tokens_pb.ts
git commit -m "feat(tokens): add access token client hooks"
```

---

## Task 16: Komponen halaman token

**Files:**
- Create: `apps/frontend/src/features/tokens/components/token-table.tsx`, `.../create-token-dialog.tsx`, `.../connect-panel.tsx`, `.../tokens-page.tsx`
- Modify: `apps/frontend/src/features/tokens/index.ts`

- [ ] **Step 1: Tabel token**

`src/features/tokens/components/token-table.tsx`:

```typescript
// One row per token. The plaintext is never present here — only `preview`,
// the last 4 characters, which is enough to tell rows apart.

import { useState } from "react";
import { KeyRound } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRevokeToken, useTokens } from "../api/hooks";
import type { AccessToken } from "../types";

function when(iso: string | null, fallback: string) {
  return iso ? new Date(iso).toLocaleDateString() : fallback;
}

export function TokenTable() {
  const { tokens, isLoading } = useTokens();
  const revoke = useRevokeToken();
  const [pending, setPending] = useState<AccessToken | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
        <KeyRound className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          No tokens yet. Create one to connect an AI client.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">
                {t.name}
                {t.expired && (
                  <Badge variant="secondary" className="ml-2">
                    Expired
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">…{t.preview}</TableCell>
              <TableCell>{when(t.createdAt, "—")}</TableCell>
              <TableCell>{when(t.expiresAt, "Never expires")}</TableCell>
              <TableCell>{when(t.lastUsedAt, "Never")}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => setPending(t)}>
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this token?</AlertDialogTitle>
            <AlertDialogDescription>
              Any AI client using this token loses access immediately.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) revoke.mutate({ id: pending.id });
                setPending(null);
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2: Dialog pembuatan**

`src/features/tokens/components/create-token-dialog.tsx`:

```typescript
// A two-stage dialog. The second stage exists because the plaintext is sent
// by the server only once: auto-closing the dialog after success would throw
// away the user's only chance to copy it.

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useCreateToken } from "../api/hooks";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "0", label: "Never expires" },
];

export function CreateTokenDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [issued, setIssued] = useState<string | null>(null);
  const create = useCreateToken();

  function reset() {
    setName("");
    setDays("90");
    setIssued(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Create token</Button>
      </DialogTrigger>
      <DialogContent>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
              <DialogDescription>
                Save it now — this token won't be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all break-all rounded-md border bg-muted p-3 font-mono text-xs">
                {issued}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy token"
                onClick={() => {
                  void navigator.clipboard.writeText(issued);
                  toast.success("Token copied");
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create access token</DialogTitle>
              <DialogDescription>
                This token gives an AI client access as you.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  value={name}
                  maxLength={64}
                  placeholder="Work laptop"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expiry">Expiry</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="token-expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!name.trim() || create.isPending}
                onClick={() => {
                  create.mutate(
                    { name: name.trim(), expiresInDays: Number(days) },
                    {
                      onSuccess: (res) => setIssued(res.token),
                      onError: (e) => toast.error(e.message),
                    },
                  );
                }}
              >
                Create
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Panel cara menyambungkan**

`src/features/tokens/components/connect-panel.tsx`:

```typescript
// Without this panel the feature isn't self-serve: the user holds a token but
// doesn't know where to paste it.

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function ConnectPanel() {
  const endpoint = `${window.location.origin}/api/tasks-rs/mcp`;
  const snippet = JSON.stringify(
    {
      mcpServers: {
        "sedjiwa-tasks": {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer <your-token>" },
        },
      },
    },
    null,
    2,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>How to connect</CardTitle>
        <CardDescription>
          Paste this configuration into your AI client, replacing
          <code className="mx-1 font-mono">&lt;your-token&gt;</code>
          with a token created below. Whoever holds that token can act as
          you in the portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-mono text-xs text-muted-foreground">{endpoint}</p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 overflow-x-auto rounded-md border bg-muted p-3 text-xs">
            {snippet}
          </pre>
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy configuration"
            onClick={() => {
              void navigator.clipboard.writeText(snippet);
              toast.success("Configuration copied");
            }}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Rakit halamannya**

`src/features/tokens/components/tokens-page.tsx`:

```typescript
import { ConnectPanel } from "./connect-panel";
import { CreateTokenDialog } from "./create-token-dialog";
import { TokenTable } from "./token-table";

export function TokensPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Access tokens</h1>
          <p className="text-sm text-muted-foreground">
            Personal access tokens for connecting an AI client to your account.
          </p>
        </div>
        <CreateTokenDialog />
      </div>
      <ConnectPanel />
      <TokenTable />
    </div>
  );
}
```

Tambahkan ekspornya di `src/features/tokens/index.ts`:

```typescript
export { TokensPage } from "./components/tokens-page";
```

- [ ] **Step 5: Verifikasi dan commit**

Run: `bun run tsc --noEmit && bun run lint`
Expected: bersih.

```bash
git add apps/frontend/src/features/tokens
git commit -m "feat(tokens): add token management UI"
```

---

## Task 17: Route dan navigasi

**Files:**
- Create: `apps/frontend/src/routes/_authed/settings/tokens.tsx`
- Modify: `apps/frontend/src/features/auth/components/app-shell.tsx`

- [ ] **Step 1: Tulis route-nya**

`src/routes/_authed/settings/tokens.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { TokensPage } from "@/features/tokens";

/**
 * Personal access token settings. No extra guard needed: `_authed` already
 * requires a session, and every RPC on this page is self-scoped on the server.
 */
export const Route = createFileRoute("/_authed/settings/tokens")({
  component: TokensPage,
});
```

- [ ] **Step 2: Tambahkan entri navigasi**

Di `src/features/auth/components/app-shell.tsx`, impor `KeyRound` dari `lucide-react` dan tambahkan sebagai entri terakhir non-admin pada `NAV`:

```typescript
    { to: "/settings/tokens", label: "Access tokens", icon: KeyRound },
```

- [ ] **Step 3: Verifikasi**

Run: `bun run build`
Expected: sukses; `src/routeTree.gen.ts` teregenerasi dan memuat `/_authed/settings/tokens`.

Run: `bun run lint`
Expected: bersih.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/routes apps/frontend/src/features/auth/components/app-shell.tsx \
        apps/frontend/src/routeTree.gen.ts
git commit -m "feat(tokens): add settings route and navigation entry"
```

---

## Task 18: Verifikasi end-to-end

**Files:** tidak ada yang diubah kecuali perbaikan yang ditemukan.

- [ ] **Step 1: Jalankan semua gate**

```bash
cd apps/backend-rs && DATABASE_URL=$DATABASE_URL cargo test --workspace \
  && cargo clippy --workspace --all-targets -- -D warnings
cd ../frontend && bun run tsc --noEmit && bun run lint && bun run build
```

Expected: semuanya lulus.

- [ ] **Step 2: Buktikan jalurnya hidup dari ujung ke ujung**

Jalankan backend (`cargo run -p app`) dan frontend (`bun run dev`), lalu:

1. Login, buka **Access tokens**, buat token bernama "laptop" dengan masa berlaku 30 hari, salin plaintext-nya.
2. Panggil `tools/list` dengan token itu:

```bash
curl -s localhost:3001/api/tasks-rs/mcp -H 'content-type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -40
```

Expected: 12 tool.

3. Buat satu task lewat `tools/call` `create_task`, lalu **muat ulang halaman project di browser** dan pastikan task itu muncul — ini yang membuktikan MCP menulis lewat jalur yang sama dengan UI.
4. Kembali ke halaman Access tokens dan pastikan kolom "Terakhir dipakai" sudah terisi.
5. Cabut token itu, ulangi panggilan `tools/list`, pastikan balasannya `401`.

- [ ] **Step 3: Commit perbaikan bila ada**

```bash
git commit -am "fix(mcp): address end-to-end verification findings"
```

Bila tidak ada temuan, lewati langkah ini — jangan membuat commit kosong.
