# Project Members Tab Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** extends `ProjectService`. Verified against Postgres. Mirrors List/Detail.

**Goal:** Backend member management for [spec](../specs/2026-07-29-project-members-tab-flow-design.md): `ListProjectMembers`, `AddProjectMember`, `RemoveProjectMember`, `LeaveProject`. TransferProjectOwnership (make-owner) already shipped.

**Scope:** these 4 ops. Frontend separate. Membership is binary (no role) — reuse the existing `ProjectMembership { project_id, user_id }` component (spec's `ProjectMembershipData`; no marker needed). Owner is derived from `ProjectOwnerId`.

**Decisions/invariants:** Add is idempotent (already-member → no-op). Add validates the user exists (→ `not_found`). Remove rejects the owner (`failed_precondition`), non-member → no-op success. Leave: caller must be a member; owner cannot leave (`failed_precondition`). Mutations return the fresh member list. Membership uniqueness stays cek-lalu-insert (idempotent) — no composite unique index.

---

## Task 1: proto — 4 member rpcs + messages

**Files:** `proto/projects.proto`.

- [ ] Add rpcs + `Member{user_id,is_owner}`, `ListProjectMembersRequest{project_id}`, `ListProjectMembersResponse{repeated members, owner_id}`, `AddProjectMemberRequest{project_id,user_id}`, `RemoveProjectMemberRequest{project_id,user_id}`, `LeaveProjectRequest{project_id}`, `LeaveProjectResponse{ok}` per spec §3.
- [ ] `cargo build -p transport`.

## Task 2: transport record.rs — member helpers

**Files:** `crates/transport/src/projects/record.rs`.

- [ ] `project_member_ids(store, project_id) -> Vec<String>` (sorted, deduped).
- [ ] `membership_pids_for_project_user(store, project_id, user_id) -> Vec<i64>`.
- [ ] `user_exists(store, user_id) -> bool` (parse pid; `store.get::<UserPhone>(pid).is_some()`).

## Task 3: transport — 4 handlers + register

**Files:** `crates/transport/src/projects/project_service.rs`.

- [ ] `members_response(owner_id, &[String]) -> pb::ListProjectMembersResponse` (`is_owner = uid==owner_id`).
- [ ] `list_project_members`: member-or-admin (else `permission_denied`) → list.
- [ ] `add_project_member`: owner/admin; user_id non-empty + `user_exists` (else `not_found`); idempotent create; return list.
- [ ] `remove_project_member`: owner/admin; owner → `failed_precondition`; delete matching membership rows (non-member = no-op); return list.
- [ ] `leave_project`: caller must be member (else `failed_precondition`); owner → `failed_precondition`; delete caller's membership rows; `{ok:true}`.
- [ ] Register all 4 on `project_router`.
- [ ] `cargo build -p app`.

## Task 4: integration test + verify

**Files:** `crates/transport/tests/project_flow.rs` (extend).

- [ ] A creates P (owner A, member A). List members as A → [A owner]; as non-member C → denied. Add B (as A) → members {A,B}, B not owner; add B again → idempotent. Remove owner A → failed_precondition; remove B → members {A}. Leave: B re-added, B leaves → gone; owner A leave → failed_precondition. Add non-existent user → not_found.
- [ ] `cargo test --workspace` (rerun-safe) + clippy clean.
- [ ] Commit `feat(backend-rs): project Members ops on per-op Store`. Don't push.
