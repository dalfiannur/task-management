# Project List / Detail-Shell Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** extends `ProjectService`. Handlers verified against Postgres. Mirrors CreateProject.

**Goal:** Backend read + authority ops for [spec](../specs/2026-07-29-project-list-detail-flow-design.md): `ListProjects` (member-scoped, status/search/pagination), `GetProject` (member-gated), `SetProjectStatus` / `TransferProjectOwnership` / `DeleteProject` (owner/admin-gated).

**Scope:** these 5 ops only. Frontend = separate flow. Cache deferred (§6) — direct-to-Postgres read-through. Load-all-and-filter-in-Rust (O(n), consistent with prior flows).

**Decisions:** List sorted by `pid` ascending (deterministic pagination). Status filter: repeated enum, empty = all, UNSPECIFIED ignored. Membership check via `ProjectMembership` scan. DeleteProject removes the project entity + its membership rows (module/task cascade = later flows, noted). SetProjectStatus rejects UNSPECIFIED (`invalid_argument`).

---

## Task 1: proto — extend ProjectService

**Files:** `proto/projects.proto`.

- [ ] Add rpcs `ListProjects`/`GetProject`/`SetProjectStatus`/`TransferProjectOwnership`/`DeleteProject` + messages (ListProjectsRequest{repeated status, optional search, uint32 page, uint32 limit}, ListProjectsResponse{repeated projects, uint32 total}, GetProjectRequest, SetProjectStatusRequest{id,status}, TransferProjectOwnershipRequest{id,new_owner_id}, DeleteProjectRequest, DeleteProjectResponse{ok}) per spec §4.
- [ ] `cargo build -p transport` (codegen).

## Task 2: transport record.rs — read + membership helpers

**Files:** `crates/transport/src/projects/record.rs`.

- [ ] `load_all_projects(store) -> Vec<ProjectRecord>` (query all `ProjectName`).
- [ ] `is_member(store, project_id, user_id) -> bool`, `member_project_ids(store, user_id) -> Vec<String>`, `membership_pids_for_project(store, project_id) -> Vec<i64>` (all via `ProjectMembership` scan).

## Task 3: transport — 5 handlers + router

**Files:** `crates/transport/src/projects/project_service.rs`.

- [ ] Guards: `require_auth`; `require_owner_or_admin(&auth, &ProjectRecord)`.
- [ ] `list_projects`: load all; admin → all, else keep those in `member_project_ids(caller)`; status filter (empty=all, valid enum values); search (name contains, case-insensitive); sort by pid; `total` = filtered len; paginate (page 1-based default 1, limit default 12).
- [ ] `get_project`: load or `not_found`; admin or member else `permission_denied`.
- [ ] `set_project_status`: load or not_found; owner/admin; parse status (reject UNSPECIFIED → invalid_argument); update `ProjectStatusComponent`; return.
- [ ] `transfer_project_ownership`: load or not_found; owner/admin; `new_owner_id` non-empty; update `ProjectOwnerId`; ensure membership for new owner; return.
- [ ] `delete_project`: load or not_found; owner/admin; `store.delete(pid)`; delete membership rows; `{ok:true}`.
- [ ] Register all 5 on `project_router`.
- [ ] `cargo build -p transport`.

## Task 4: integration test + verify

**Files:** `crates/transport/tests/project_flow.rs` (extend).

- [ ] Two users A/B (distinct tokens). A creates P1 (owner A) + P2 (owner A, member B via explicit-owner? no — use transfer/membership); B creates P3. List as A → sees P1,P2 (not P3); List as admin → sees all; status filter + search + pagination bounds. GetProject P1 as A → ok; as B (non-member) → permission_denied; unknown id → not_found. SetProjectStatus as A → ok; as B → permission_denied; UNSPECIFIED → invalid_argument. Transfer P1 A→B → owner B, B is member; then A (old owner) can't set status. Delete P2 as A → ok; GetProject P2 → not_found; memberships gone.
- [ ] `cargo test --workspace` (rerun-safe, unique ids) + clippy clean.
- [ ] Commit `feat(backend-rs): project List/Detail ops on per-op Store`. Don't push.
