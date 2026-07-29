# Pages Tab (Project Wiki) Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** a new `PageService`. Mirrors ModuleService. Verified against Postgres.

**Goal:** Backend project-wiki pages per [spec](../specs/2026-07-29-project-pages-tab-flow-design.md): markdown pages per project, ordered, CRUD + reorder. All ops member-gated (collaborative, like tasks).

**Scope/deferrals:** activity emit (§4) deferred — system not built. Project-level only (no task/module links). Reuse `crate::projects::record::is_member` for membership.

**Decisions (learned from prior flows):** page id = pid string. "Is a page" = has `PageInfo`. Sort field is `sort_order` (`order` is reserved SQL). Create defaults: title="Untitled", content="", icon="", order=append. Author names NOT denormalized (frontend resolves). Update: absent field = unchanged; last_edited_by=caller, updated_at=now.

---

## Task 1: domain — page components (TDD-light)

**Files:** Create `crates/domain/src/page.rs`; modify `lib.rs` (mod + register_all).

- [ ] `PageInfo{ #[pg(index)] project_id, title, icon, content, #[pg(index)] sort_order:i32 }`, `PageAudit{ #[pg(index)] created_by, last_edited_by, #[pg(index)] created_at, updated_at }`. Const `DEFAULT_PAGE_TITLE = "Untitled"`.
- [ ] register_all registers both. `cargo test -p domain`.

## Task 2: proto — pages.proto

**Files:** Create `proto/pages.proto` (`package sedjiwa.tasks.page.v1`), PageService + messages per spec §3; add to build.rs.
- [ ] `cargo build -p transport` — types at `crate::sedjiwa::tasks::page::v1`.

## Task 3: transport — records + PageService

**Files:** Create `crates/transport/src/pages/{mod.rs,record.rs,page_service.rs}`; modify `transport/src/lib.rs`.

- [ ] mod.rs: `internal`, `parse_pid`, `require_auth`, `require_member(project_id)` (via projects::record::is_member).
- [ ] record.rs: `PageRecord` + `read_page`/`to_proto`/`load_page(pid)`/`pages_for_project(project_id)` (sorted by sort_order, pid).
- [ ] page_service.rs handlers (all member-gated; project via page.project_id, create via request):
  - `list_pages` (member; sorted), `get_page` (member), `create_page` (member of project; defaults; append order; audit), `update_page` (member; patch title/icon/content; last_edited_by/updated_at), `delete_page` (member; delete), `reorder_pages` (member; order=index for project's pages). `page_router`.
- [ ] `cargo build -p transport`.

## Task 4: app — wire + integration test + verify

**Files:** `router.rs` merge `page_router`; `crates/transport/tests/page_flow.rs`.

- [ ] Merge page_router. `cargo build -p app`.
- [ ] Integration: member creates page (defaults Untitled/append order); list/get member-gated (non-member denied); update patches + last_edited_by/updated_at; reorder; delete. Unknown id → not_found.
- [ ] `cargo test --workspace` (rerun-safe) + clippy clean.
- [ ] Commit `feat(backend-rs): project Pages (wiki tab) on per-op Store`. Don't push.
