# Activity Feed Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** cross-cutting audit log. `record` wired into ~15 mutation sites + 3 read RPCs. Verified against Postgres.

**Goal:** Project-wide audit log per [spec](../specs/2026-07-29-activity-feed-flow-design.md): record Task/Module/Membership/Ownership/Page/Media changes; read per-project, per-entity, and recent-cross-project (Dashboard).

**Architecture:** `record(store, project_id, actor_id, entity_type, entity_id, action, summary, changes)` — best-effort (logs on error, never fails the mutation), called directly after each successful mutation (no Option gate needed; unlike Notifier there's no shared state, only the Store). Own actions ARE recorded (no self-suppression). `summary` is a snapshot; `changes` (diff) only for Updated. Read = member-scoped.

**Decisions:** activity id = pid string. `EntityType`/`ActivityAction` stored as indexed String. `FieldChange` is a JSONB payload (`arke::Serialize`), `Vec<FieldChange>` in `ActivityChanges`. Task-update gets a real diff (status/priority/title/dates); module/page update pass empty changes (summary suffices) — bounded per §8.1. Delete records use the pre-delete snapshot.

---

## Task 1: domain — activity components + enums + FieldChange

**Files:** `crates/domain/src/activity.rs`; lib.rs.

- [ ] `FieldChange{field, from:Option<String>, to:Option<String>}` (`#[derive(arke::Serialize, Clone, Debug, PartialEq)]`). `ActivityInfo{ #[pg(index)] project_id, #[pg(index)] actor_id, #[pg(index)] entity_type:String, #[pg(index)] entity_id, #[pg(index)] action:String, summary, #[pg(index)] created_at }`. `ActivityChanges{ changes: Vec<FieldChange> }` (JSONB). `EntityType{Task,Module,Membership,Ownership,Page,Media}` + `ActivityAction{Created,Updated,Deleted}` (as_str/parse/to_proto/from_proto). register_all. Test.

## Task 2: proto — activity.proto

**Files:** `proto/activity.proto` (`package sedjiwa.tasks.activity.v1`) per spec §3; build.rs. `cargo build -p transport`.

## Task 3: transport — recorder + records + ActivityService

**Files:** `crates/transport/src/activity/{mod.rs,recorder.rs,record.rs,activity_service.rs}`; transport lib.rs.

- [ ] recorder.rs: `pub(crate) async fn record(store, project_id, actor_id, entity_type: EntityType, entity_id, action: ActivityAction, summary: String, changes: Vec<FieldChange>)` (best-effort; created_at=now). Re-export EntityType/ActivityAction/FieldChange for callers.
- [ ] record.rs: ActivityRecord + read/to_proto/load + activity_for_project / activity_for_entity / activity_for_projects (created_at desc).
- [ ] mod.rs: guards (require_auth, require_member).
- [ ] activity_service.rs: list_project_activity (member; paginated), list_entity_activity (member via entity→project; project derived per entity_type: Task→task_project_id, Module→module project, Page/Media→their project_id, Membership/Ownership→entity is project-scoped so need project_id... entity_id for those is user id — derive via the activity's own project_id lookup: simplest = find any activity row for that entity to get project_id, then member-check; else fall back), list_recent_activity (member's projects; admin=all). `activity_router`.

## Task 4: wire record into mutation handlers

- [ ] work: create/update/delete task (Task; update with diff), create/update/delete/reorder module (Module).
- [ ] projects: add/remove member (Membership), transfer (Ownership).
- [ ] pages: create/update/delete (Page).
- [ ] media: complete-upload (Media·Created), delete (Media·Deleted).
- [ ] Delete sites record with the pre-delete snapshot.

## Task 5: app — merge router + verify

- [ ] router.rs merge `activity_router`. `cargo build -p app`.

## Task 6: integration test + verify

**Files:** `crates/transport/tests/activity_flow.rs`.

- [ ] Do actions (create task/module, add member, update task, delete task, create page, transfer) → ListProjectActivity shows them newest-first with right entity_type/action/summary; ListEntityActivity(TASK, id) shows only that task's rows; ListRecentActivity member-scoped (admin all); non-member denied. `cargo test --workspace` (rerun-safe) + clippy. Commit. Don't push.
