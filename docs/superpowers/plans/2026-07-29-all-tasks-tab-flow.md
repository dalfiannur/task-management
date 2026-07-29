# All-Tasks Tab (Modules & Tasks) Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** two new services on the per-op Store. Built incrementally (domain → modules → tasks), verified against Postgres.

**Goal:** Backend Modules & Tasks per [spec](../specs/2026-07-29-project-all-tasks-tab-flow-design.md): `ModuleService` (list/create/update/delete-cascade/reorder) + `TaskService` (list/create/update/delete/move). Project→Modules→Tasks; module CRUD = owner/admin, task CRUD = any member.

**Scope/deferrals:** activity + notification **emits** (§4.7) deferred — those systems don't exist yet (noted in code). Label-id validation **loose** (§8.3) — not validated. Server order **normalization on move** simplified: Move sets module_id+order as given; reads sort by (order, pid). Create appends (max+1). Reorder sets order=index.

**Reuse:** membership/ownership from `crate::projects::record` (make it `pub(crate)`): `is_member`, `load_project`, `project_member_ids`. Project derived: module→`ModuleProjectRef.project_id`; task→module→project.

---

## Task 1: domain — module + task components + enums + rules (TDD)

**Files:** Create `crates/domain/src/module.rs`, `crates/domain/src/task.rs`; modify `lib.rs` (mods + `register_all`).

- [ ] module.rs: `ModuleName{value}`, `ModuleDescription{value}`, `ModuleProjectRef{#[pg(index)] project_id}`, `ModuleOrder{#[pg(index)] value:i32}`. ("Is a module" = has ModuleName.)
- [ ] task.rs: `TaskInfo{title, description, #[pg(index)] status:String, #[pg(index)] priority:String, start_date:Option<String>, due_date:Option<String>, #[pg(index)] order:i32}`, `TaskModuleRef{#[pg(index)] module_id}`, `TaskAssignees{user_ids:Vec<String>}` (JSONB), `TaskLabels{label_ids:Vec<String>}` (JSONB), `TaskAudit{created_at, updated_at, completed_at:Option<String>, created_by}`.
- [ ] `TaskStatus{Todo,InProgress,Done,Cancelled}` + `TaskPriority{None,Low,Medium,High,Urgent}` — each `as_str`/`parse`/`to_proto`/`from_proto` (proto: TODO=1.. / NONE=1..). Rule helper `title_ok`.
- [ ] Tests: status/priority round-trip + proto; title validation.
- [ ] `register_all` registers all 9 components. `cargo test -p domain` green.

## Task 2: proto — work.proto (ModuleService + TaskService)

**Files:** Create `proto/work.proto` (`package sedjiwa.tasks.work.v1`), messages + enums per spec §3; add to `transport/build.rs`.

- [ ] `cargo build -p transport` — types at `crate::sedjiwa::tasks::work::v1`.

## Task 3: transport work module — records + ModuleService

**Files:** Create `crates/transport/src/work/{mod.rs,record.rs,module_service.rs}`; modify `transport/src/lib.rs`; change `projects/mod.rs` `mod record;` → `pub(crate) mod record;`.

- [ ] record.rs: `ModuleRecord` + `read_module`/`to_proto`/`load_module(pid)`/`modules_for_project(project_id)`; guards `require_auth`, `require_member(project_id)`, `require_owner_or_admin(project_id)` (load project via `projects::record::load_project`), `module_project_id(module_pid)`.
- [ ] module_service.rs handlers: `list_modules` (member; sorted by order), `create_module` (owner/admin; append order), `update_module` (owner/admin; name/description), `delete_module` (owner/admin; cascade delete tasks with that module_id), `reorder_modules` (owner/admin; set order=index for given ids). `module_router`.
- [ ] `cargo build -p transport`.

## Task 4: transport — TaskService

**Files:** Create `crates/transport/src/work/task_service.rs`, `task_record.rs`; modify work/mod.rs.

- [ ] task_record.rs: `TaskRecord` (all fields) + `read_task`/`to_proto`/`load_task(pid)`/`tasks_for_module`/`tasks_for_project` (join module→project via module ids). `task_project_id(task_pid)` (task→module→project).
- [ ] task_service.rs handlers (member-gated; project via task's module):
  - `list_tasks`: by project (optional module filter); sorted by (order, pid).
  - `create_task`: member of module's project; validate module exists; validate assignees ⊆ project members (else invalid_argument); status/priority from proto (default TODO/NONE if UNSPECIFIED); append order; audit created_by=caller, created_at=updated_at=now, completed_at set iff status Done.
  - `update_task`: member; patch provided fields; assignee validation; `completed_at` auto (→Done sets now, leaving Done clears); updated_at=now.
  - `delete_task`: member; delete.
  - `move_task`: member of both source+dest project (same project); validate dest module; set module_id+order; updated_at=now.
  - `task_router`.
- [ ] `cargo build -p transport`.

## Task 5: app — register + wire

- [ ] main/register_all already done (Task 1). router.rs: merge `module_router` + `task_router`. `cargo build -p app`.

## Task 6: integration test + verify

**Files:** `crates/transport/tests/work_flow.rs` (gated on DATABASE_URL; real users + project via helpers).

- [ ] Modules: create (owner) appends order; list sorted; member can't create (permission_denied); update; reorder; delete cascades its tasks. Tasks: member creates (append); assignee-not-member rejected; status→Done sets completed_at, leaving clears; update patches; move between modules; list by project + by module; non-member denied.
- [ ] `cargo test --workspace` (rerun-safe) + clippy clean.
- [ ] Commit `feat(backend-rs): Modules & Tasks (all-tasks tab) on per-op Store`. Don't push.
