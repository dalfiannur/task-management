# Users & Auth Flow — Implementation Plan (per-op Store)

> **For agentic workers:** execute task-by-task; pure logic is TDD (`cargo test -p <crate>`), handlers verified against Postgres. Steps use `- [ ]`.

**Goal:** Implement the self-contained Users/Auth flow (register/login/me, self-service profile/password, directory picker, admin user management) on the per-op pid `Store`, per [spec](../specs/2026-07-29-users-auth-flow-design.md).

**Architecture:** Layered — `domain` (PgComponents + pure rules), `auth` (Argon2id hash + HS256 JWT sign/verify), `transport` (Connect handlers orchestrating domain+persistence+auth, proto codegen), `app` (router wiring + seed). Per-op `Store`; user identity = DB `pid` as string. User lookups load all users (`query::<UserPhone>`) and filter in Rust (safe, O(n); index-lookup optimization deferred).

**Adopted decisions (spec §8):** `BASE_PERMISSIONS = ["projects:create"]`; min password len 8; no Bun-hash compat; two services (AuthService public + UserDirectoryService active/admin); generic login error for bad credentials, specific for Pending/Suspended.

**Deviations from spec §2 (persistence):** derive rejects 0-field structs → no `UserTag`/`AdminTag` markers. "Is a user" = has `UserPhone`. Admin = presence of `AdminMark { granted_at }`. `UserStatus` stored as `String` (indexed) not an enum column.

**Test DB:** `arke-pid-pg` :55432; `DATABASE_URL=postgres://postgres:postgres@localhost:55432/arke_test`. Recreate DB clean before handler integration runs.

---

## Task 1: domain — user components + UserStatus + pure rules

**Files:** Create `crates/domain/src/user.rs`; modify `crates/domain/src/lib.rs` (add `pub mod user;`).

- [ ] **Step 1:** Define PgComponents in `user.rs`:
  ```rust
  use arke_postgres::PgComponent;

  #[derive(PgComponent, Debug, Clone)]
  pub struct UserPhone {
      #[pg(index, unique)] pub value: String,
      pub verified: bool,
  }
  #[derive(PgComponent, Debug, Clone)]
  pub struct UserPassword { pub hash: String, pub changed_at: String }
  #[derive(PgComponent, Debug, Clone)]
  pub struct UserProfile {
      #[pg(index)] pub display_name: String,
      pub avatar_url: String,
      pub email: String,
  }
  #[derive(PgComponent, Debug, Clone)]
  pub struct UserStatusComponent {
      #[pg(index)] pub status: String,       // UserStatus::as_str
      pub created_at: String,
      pub last_login_at: Option<String>,
  }
  /// Presence = admin (derive rejects 0-field structs, so carry a timestamp).
  #[derive(PgComponent, Debug, Clone)]
  pub struct AdminMark { pub granted_at: String }
  ```
- [ ] **Step 2:** `UserStatus` enum + conversions + pure rules (TDD — write tests first):
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq)]
  pub enum UserStatus { Pending, Active, Suspended }
  impl UserStatus {
      pub fn as_str(self) -> &'static str { match self { Self::Pending=>"pending", Self::Active=>"active", Self::Suspended=>"suspended" } }
      pub fn parse(s: &str) -> Option<Self> { match s { "pending"=>Some(Self::Pending), "active"=>Some(Self::Active), "suspended"=>Some(Self::Suspended), _=>None } }
      /// proto wire enum: PENDING=1, ACTIVE=2, SUSPENDED=3.
      pub fn to_proto(self) -> i32 { match self { Self::Pending=>1, Self::Active=>2, Self::Suspended=>3 } }
  }
  pub const MIN_PASSWORD_LEN: usize = 8;
  pub const BASE_PERMISSIONS: &[&str] = &["projects:create"];
  /// Permissions minted at login: admin → ["*"], else BASE.
  pub fn permissions_for(is_admin: bool) -> Vec<String> {
      if is_admin { vec!["*".into()] } else { BASE_PERMISSIONS.iter().map(|s| s.to_string()).collect() }
  }
  pub fn password_ok(pw: &str) -> bool { pw.chars().count() >= MIN_PASSWORD_LEN }
  ```
- [ ] **Step 3:** Tests in `user.rs` `#[cfg(test)]`: `UserStatus::parse`/`as_str` round-trip + `to_proto`; `permissions_for(true)==["*"]`, `permissions_for(false)==["projects:create"]`; `password_ok` boundary (7 false, 8 true).
- [ ] **Step 4:** `cargo test -p domain` green.

## Task 2: auth — Argon2id hashing + JWT signing

**Files:** Modify `crates/auth/Cargo.toml` (add `argon2`, `time`); create `crates/auth/src/hash.rs`; modify `crates/auth/src/lib.rs` (add `mod hash; pub use`, add `sign_jwt`).

- [ ] **Step 1:** Add deps to `auth/Cargo.toml`: `argon2 = { workspace = true }`, `time = { workspace = true }`. (Add `argon2 = "0.5"` to the workspace `[workspace.dependencies]` if absent.)
- [ ] **Step 2:** `hash.rs` (TDD): `pub fn hash_password(pw: &str) -> Result<String, HashError>` (Argon2id default params, random salt via `argon2::password_hash::SaltString::generate`), `pub fn verify_password(pw: &str, phc: &str) -> bool`. Test: hash then verify true; wrong password verify false; two hashes of same pw differ (salt).
- [ ] **Step 3:** In `lib.rs`, add signing:
  ```rust
  use jsonwebtoken::{encode, EncodingKey, Header};
  /// Sign an HS256 JWT. `exp` is an absolute unix seconds.
  pub fn sign_jwt(secret: &str, sub: &str, permissions: &[String], exp: usize) -> Result<String, AuthError> {
      let claims = Claims { sub: sub.into(), permissions: permissions.to_vec(), exp };
      encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(secret.as_bytes()))
          .map_err(|_| AuthError::Invalid)
  }
  ```
- [ ] **Step 4:** Test: `sign_jwt` then `verify_jwt` round-trips id + permissions.
- [ ] **Step 5:** `cargo test -p auth` green.

## Task 3: proto — users.proto + codegen

**Files:** Create `crates/transport/proto`? No — proto lives at `apps/backend-rs/proto/`. Create `apps/backend-rs/proto/users.proto`; modify `crates/transport/build.rs`.

- [ ] **Step 1:** Write `proto/users.proto`, `package sedjiwa.tasks.auth.v1`, exactly the messages/services from spec §4 (AuthService + UserDirectoryService, User, UserStatus enum, all request/response messages).
- [ ] **Step 2:** `build.rs`: add `users.proto` to the `compile_protos` slice and a `rerun-if-changed`. (Both protos compile into the same `generated.rs`.)
- [ ] **Step 3:** `cargo build -p transport` — generated types exist at `crate::sedjiwa::tasks::auth::v1`. (Handlers not yet wired; just confirm codegen.)

## Task 4: transport — user record mapper + AuthService handlers

**Files:** Create `crates/transport/src/users/mod.rs`, `crates/transport/src/users/record.rs`, `crates/transport/src/users/auth_service.rs`; modify `crates/transport/src/lib.rs` (`mod users;`, re-export routers).

- [ ] **Step 1:** `record.rs`: `UserRecord` (flattened: pid, phone, verified, display_name, email, avatar_url, status: UserStatus, is_admin, created_at, last_login_at, password_hash) + `fn read_user(world: &World, e: Entity, pid: i64) -> Option<UserRecord>` (reads all components; None if core components missing) + `fn to_proto(&UserRecord) -> pb::User` (omits hash). Helpers `load_all_users(&Store)` (via `store.query::<UserPhone,_>(None, ...)`) and `load_user(&Store, pid)` (query filtered to pid in Rust).
- [ ] **Step 2:** `auth_service.rs` handlers (each `async fn(Extension<Arc<Store>>, [Option<Extension<AuthUser>>,] ConnectRequest<..>) -> Result<ConnectResponse<..>, ConnectError>`):
  - `register`: validate `password_ok` (→ `invalid_argument`); reject blank phone/display_name; check phone unique via `load_all_users` (→ `already_exists`); `hash_password`; `store.create((UserPhone, UserPassword, UserProfile, UserStatusComponent{status:"pending", created_at:now}))`; return `to_proto` (no token).
  - `login`: find user by phone (`load_all_users`); generic `unauthenticated` if not found or `verify_password` false; if status Pending/Suspended → `failed_precondition` (specific message); mint `permissions_for(is_admin)` + `sign_jwt` (exp = now + parse(jwt_expires_in)); `store.update(pid, set last_login_at=now)`; return `{token, user}`.
  - `me`: require `AuthUser`; parse id→pid; `load_user`; → `User` (`not_found` if gone).
  - `update_my_profile`: require auth; `store.update` UserProfile fields (only provided Options); return updated `User`.
  - `change_my_password`: require auth; load user; `verify_password(current)` (→ `failed_precondition`); `password_ok(new)`; `store.update` UserPassword{hash, changed_at=now}; `{ok:true}`.
- [ ] **Step 3:** `pub fn auth_router(store: Arc<Store>, secret: Arc<str>) -> axum::Router<()>` — build `AuthServiceBuilder::<()>::new()` with turbofish extractor tuples (mirror `health_router`), `.layer(Extension(store))` + `.layer(Extension(secret))` (login needs the secret + expiry; pass a small `JwtConfig{secret, expires_in}` extension instead).
- [ ] **Step 4:** `cargo build -p transport`.

## Task 5: transport — UserDirectoryService handlers

**Files:** Create `crates/transport/src/users/directory_service.rs`; modify `users/mod.rs`.

- [ ] **Step 1:** Guard helpers: `require_active(&Store, &AuthUser) -> Result<(), ConnectError>` (loads caller, checks status Active or admin); `require_admin(&AuthUser)`.
- [ ] **Step 2:** Handlers:
  - `search_users`: require active; `load_all_users`, filter Active + (q substring on display_name/phone), map to proto.
  - `get_user`: require active; `load_user(pid)` → User.
  - `list_users` (admin): all users, optional status filter.
  - `create_user` (admin): like register but status Active immediately + optional admin (`AdminMark`).
  - `update_user` (admin): update profile fields by id.
  - `activate_user`/`suspend_user` (admin): set status.
  - `set_admin` (admin): add/remove `AdminMark`.
  - `reset_password` (admin): `password_ok`; set new UserPassword.
  - `delete_user` (admin): `store.delete(pid)`.
- [ ] **Step 3:** `pub fn user_router(store: Arc<Store>) -> axum::Router<()>`.
- [ ] **Step 4:** `cargo build -p transport`.

## Task 6: app — register components + wire routers + seed

**Files:** Modify `crates/app/src/main.rs` (register user components), `crates/app/src/router.rs` (merge auth+user routers); create `crates/app/src/bin/seed_admin.rs`.

- [ ] **Step 1:** In `main.rs` `Store::connect` register closure, register all 5 user components (+ keep HeartbeatAt).
- [ ] **Step 2:** `router.rs`: merge `transport::auth_router(...)` and `transport::user_router(...)` with `health_router` via `.merge(...)`, keep the `auth_layer` + CORS layers over the whole thing. Pass `JwtConfig` extension.
- [ ] **Step 3:** `bin/seed_admin.rs`: idempotent — connect Store, if no user with the seed phone exists, create an Active admin (`AdminMark`) from `SEED_ADMIN_PHONE`/`SEED_ADMIN_PASSWORD`/`SEED_ADMIN_NAME` env (defaults for dev). Print result.
- [ ] **Step 4:** `cargo build -p app`.

## Task 7: integration test — end-to-end against Postgres

**Files:** Create `crates/transport/tests/users_flow.rs` (gated on `DATABASE_URL`).

- [ ] **Step 1:** Test the pure orchestration where possible by calling handler helpers, or a full HTTP round-trip via the built router + `tower::ServiceExt::oneshot` with Connect JSON bodies. Minimum: register → pending; login pending → FAILED_PRECONDITION; admin activate; login → token; me(token) → user; search finds it; change password; login with new password.
- [ ] **Step 2:** Recreate DB clean; `DATABASE_URL=… cargo test -p transport --test users_flow -- --test-threads=1` green.

## Task 8: full verify

- [ ] **Step 1:** `cargo test --workspace` (pure units) green; clippy clean (`cargo clippy --workspace`).
- [ ] **Step 2:** Recreate DB; run seed_admin; boot `cargo run -p app`; smoke `Login`/`Me` over HTTP (curl Connect JSON) — token issued, `Me` returns the admin.
- [ ] **Step 3:** Commit `feat(backend-rs): Users/Auth flow on per-op Store`. Do not push (await user).
