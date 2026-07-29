# Comments Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** a `CommentService`. Project derived from task. Verified against Postgres.

**Goal:** Flat task comments per [spec](../specs/2026-07-29-comments-flow-design.md): list (paginated)/create/update/delete, markdown + @mentions. Mentions filtered to project members; mention→notification emit deferred (Notifications flow unbuilt — safe no-op).

**Decisions:** comment id = pid string. "Is a comment" = has `CommentInfo`. Project via `crate::work::task_project_id`. Guards: list = member; create = member; update = author only; delete = author/owner/admin. content non-empty. Mentions stored filtered to valid project members (non-members ignored). Sorted created_at asc; page 1-based, page_size default 50, total before pagination.

---

## Task 1: domain — comment component + rule

**Files:** Create `crates/domain/src/comment.rs`; modify lib.rs.

- [ ] `CommentInfo{ #[pg(index)] task_id, #[pg(index)] author_id, content, mentioned_user_ids:Vec<String> (JSONB), #[pg(index)] created_at, updated_at }`; `content_ok` (trim non-empty) + test. register_all.

## Task 2: proto — comments.proto

**Files:** `proto/comments.proto` (`package sedjiwa.tasks.comment.v1`) per spec §3; build.rs. `cargo build -p transport`.

## Task 3: transport — records + CommentService

**Files:** `crates/transport/src/comments/{mod.rs,record.rs,comment_service.rs}`; transport lib.rs.

- [ ] mod.rs: guards (require_auth, require_member(project), require_author, require_author_owner_or_admin), StoreExt.
- [ ] record.rs: CommentRecord + read/to_proto/load_comment/comments_for_task (sorted created_at asc).
- [ ] comment_service.rs:
  - list_comments (member via task→project; paginate; total).
  - create_comment (member; content non-empty; author=caller; mentions ∩ project members; created_at=updated_at=now; // notify(new) deferred).
  - update_comment (author only; content non-empty; replace content + mentions∩members; updated_at=now; // notify(new-vs-old) deferred).
  - delete_comment (author/owner/admin).
  - comment_router.

## Task 4: app — wire + integration test + verify

**Files:** router.rs merge; `crates/transport/tests/comment_flow.rs`.

- [ ] Merge comment_router. Test: member comments (author set, blank rejected); mention filtered to members (non-member ignored); list paginated + member-gated (non-member denied); author-only edit (other member denied); delete by author/owner/admin (plain member denied). `cargo test --workspace` (rerun-safe) + clippy. Commit `feat(backend-rs): task Comments on per-op Store`. Don't push.
