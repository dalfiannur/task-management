# Dashboard & My-Tasks Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** pure cross-project aggregation (no new entities). Reuses Task/Project/Comment. Verified against Postgres.

**Goal:** Cross-project read aggregation per [spec](../specs/2026-07-29-dashboard-my-tasks-flow-design.md): `DashboardService` (stats + upcoming deadlines) + `MyTasksService` (assigned/created/involving). All scoped to the caller's member projects (admin: all).

**Architecture:** one `dashboard.proto` (package `sedjiwa.tasks.dashboard.v1`, `import "work.proto"` so `MyTask.task` = `work.v1.Task`, reusing work's TaskStatus/TaskPriority). A `Context` loader builds, per request: member-project scope, module→project + names maps, all projects' names, all tasks. Handlers filter tasks by scope + criteria. O(n) scans (no cache yet, §5). Reuse: `projects::record::{load_all_projects, member_project_ids}` (pub(crate)); expose `work::record` + `work::task_record` as pub(crate) with `load_all_modules`/`load_all_tasks` + task `to_proto`.

**Decisions:** total = non-cancelled tasks; done/in_progress separate; overdue = due_date < today (ISO yyyy-MM-dd lexicographic) && status ∉ {done,cancelled}. Upcoming = assigned-to-me, due within N days (default 7), not done/cancelled. Involving-me = tasks I authored a comment on OR was mentioned in (comments only, no overlap with created/assigned).

---

## Task 1: expose work helpers

**Files:** `work/mod.rs` (`pub(crate) mod record; pub(crate) mod task_record;`); `work/record.rs` (+`load_all_modules`); `work/task_record.rs` (+`load_all_tasks`, ensure `to_proto`/`TaskRecord` pub(crate)).

## Task 2: proto — dashboard.proto

**Files:** `proto/dashboard.proto` (import work.proto) per spec §2.2/§3.1, both services + MyTask/DashboardStats/etc.; build.rs. Confirm cross-package import compiles (`cargo build -p transport`).

## Task 3: transport — Context + handlers

**Files:** `crates/transport/src/dashboard/{mod.rs,context.rs,dashboard_service.rs,mytasks_service.rs}`; transport lib.rs.

- [ ] context.rs: `Context{scope:Option<HashSet<String>>, module_to_project, module_names, project_names, tasks:Vec<TaskRecord>}` + `load(store, auth)`; `to_mytask(&self, &TaskRecord) -> Option<pb::MyTask>`; `scoped_tasks(&self) -> Vec<&TaskRecord>` (task's project in scope); `today() -> String`.
- [ ] mod.rs: guards (require_auth), StoreExt, internal.
- [ ] dashboard_service.rs: `get_dashboard_stats` (totals + per-project done/total + overdue), `get_upcoming_deadlines` (assigned-to-me, due in within_days, not done/cancelled). `dashboard_router`.
- [ ] mytasks_service.rs: `list_assigned_to_me` / `list_created_by_me` / `list_involving_me` (status/priority filter + pagination; involving via comment scan). `mytasks_router`.

## Task 4: app — merge routers + integration test + verify

**Files:** router.rs merge both; `crates/transport/tests/dashboard_flow.rs`.

- [ ] Test: set up 2 projects (caller member of one), tasks with assignees/creator/due dates, a comment mention → dashboard stats scoped + overdue; upcoming deadlines; assigned/created/involving lists scoped + filtered + paginated; non-member's project excluded. `cargo test --workspace` (rerun-safe) + clippy. Commit `feat(backend-rs): Dashboard & My-Tasks aggregation`. Don't push.
