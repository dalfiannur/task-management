# Create Project Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** pure logic TDD; handler verified against Postgres. Mirrors the Users/Auth build.

**Goal:** Backend `CreateProject` on the per-op Store, per [spec](../specs/2026-07-29-create-project-flow-design.md): local delivery-only project, single owner + auto owner membership, status Active, no Core Portal, no sub-projects.

**Scope:** `CreateProject` only (List/Get/Update are later flows). Frontend Connect-consumer is a separate flow (new stack). Membership modeled minimally here (owner row on create).

**Decisions (following Users/Auth patterns):** project id = `pid` string. "Is a project" = has `ProjectName` (derive rejects 0-field markers). `ProjectStatus` stored as indexed-free `String`; domain enum for logic. Membership = its own entity `ProjectMembership { project_id, user_id }` (string ids, per-op-relation-free). Permission: authenticated + `projects:create` (admin `*` covered). Project + membership are **separate per-op creates** (not atomic — noted; multi-entity tx is a later concern).

---

## Task 1: domain — project components + rules (TDD)

**Files:** Create `crates/domain/src/project.rs`; modify `lib.rs` (`pub mod project;` + register in `register_all`).

- [ ] Components: `ProjectName{value}`, `ProjectDescription{value}`, `ProjectOwnerId{#[pg(index)] value}`, `ProjectStatusComponent{value}` (status string), `ProjectDates{start_date:Option<String>, end_date:Option<String>}`, `ProjectCoreRef{#[pg(index)] value}` (legacy), `ProjectMembership{#[pg(index)] project_id, #[pg(index)] user_id}`.
- [ ] `ProjectStatus` enum {Active,Completed,Archived} + `as_str`/`parse`/`to_proto` (ACTIVE=1,COMPLETED=2,ARCHIVED=3); `project_name_ok(&str)` (trim non-empty).
- [ ] Tests: status round-trip + to_proto; name validation.
- [ ] `register_all` registers all project + membership components.
- [ ] `cargo test -p domain` green.

## Task 2: proto — projects.proto + codegen

**Files:** Create `proto/projects.proto` (`package sedjiwa.tasks.project.v1`, ProjectService.CreateProject, Project, CreateProjectRequest, ProjectStatus enum per spec §4.2); add to `transport/build.rs`.

- [ ] `cargo build -p transport` — types at `crate::sedjiwa::tasks::project::v1`.

## Task 3: transport — CreateProject handler + router

**Files:** Create `crates/transport/src/projects/mod.rs`, `record.rs`, `project_service.rs`; modify `lib.rs`.

- [ ] `record.rs`: `ProjectRecord` (pid, name, description:Option, status, owner_id, start_date:Option, end_date:Option) + `read_project(world,e,pid)` + `to_proto` + `load_project(store,pid)`.
- [ ] `project_service.rs::create_project`: require auth (`unauthenticated`); require `auth.has("projects:create")` (`permission_denied`); validate name (`invalid_argument`); `owner_id = req.owner_id.filter(non-empty).unwrap_or(auth.id)`; create project (ProjectName+ProjectOwnerId+ProjectStatusComponent{active}, +ProjectDescription if non-empty via update); create owner `ProjectMembership`; if owner_id != auth.id also create creator membership; return `to_proto(load_project(pid))`.
- [ ] `project_router(store)`.
- [ ] `cargo build -p transport`.

## Task 4: auth — permission helper

**Files:** modify `crates/auth/src/lib.rs`.

- [ ] `AuthUser::has(&self, perm: &str) -> bool { self.is_admin() || self.permissions.iter().any(|p| p == perm) }` + test.

## Task 5: app — register + wire

**Files:** modify `router.rs` (merge `project_router`). (`register_all` already updated in Task 1.)

- [ ] `cargo build -p app`.

## Task 6: integration test + verify

**Files:** `crates/transport/tests/project_flow.rs` (gated on `DATABASE_URL`).

- [ ] Mint a user token (via `sign_jwt` with `["projects:create"]`); CreateProject → 200, status ACTIVE, owner_id = caller; owner membership row exists; default-owner vs explicit-owner (creator also a member); unauthenticated → 401; blank name → error.
- [ ] `cargo test --workspace` + clippy clean.
- [ ] Commit `feat(backend-rs): CreateProject flow on per-op Store`. Don't push.
