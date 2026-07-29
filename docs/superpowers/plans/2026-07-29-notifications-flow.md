# Notifications Flow — Implementation Plan (backend, per-op Store + real-time)

> **For agentic workers:** cross-cutting flow. New service + shared `emit` wired into 4 existing services + Connect server-streaming. Verified against Postgres.

**Goal:** In-app notifications + real-time per [spec](../specs/2026-07-29-notifications-flow-design.md): Notification entity, list/unread/mark-read, `StreamNotifications` (server-streaming), and `emit_notification` called by Comment/Task/Project/Auth services.

**Architecture:** `Notifier` (in-memory registry `recipient → Vec<UnboundedSender<Result<Notification,ConnectError>>>`) injected as a **global** extension. `emit(store, notifier, recipient, kind, actor, message, refs)`: no-op if recipient==actor; persist NotificationInfo+NotificationRefs (read=false); broadcast to live streams. Emitting handlers extract `Option<Extension<Arc<Notifier>>>` so existing tests (no Notifier) still no-op. Single-instance in-memory (multi-instance fan-out = deferred, §6).

**Decisions:** notification id = pid string. Message is a **snapshot** rendered at emit. `read` = bool. Kind stored as indexed String. All ops scoped to `AuthUser.id`. List newest-first, paginated.

---

## Task 1: domain — notification components + enum

**Files:** Create `crates/domain/src/notification.rs`; modify lib.rs.

- [ ] `NotificationInfo{ #[pg(index)] recipient_id, #[pg(index)] kind:String, actor_id, message, #[pg(index)] read:bool, #[pg(index)] created_at }`; `NotificationRefs{ project_id:Option<String>, task_id:Option<String>, comment_id:Option<String> }`; `NotificationType{Mention,TaskAssigned,ProjectMemberAdded,OwnershipTransferred,AccountApproved}` (as_str/parse/to_proto/from_proto, 1..5). register_all. Test.

## Task 2: proto — done (notifications.proto + build.rs).

## Task 3: transport — Notifier + emit + records + NotificationService

**Files:** transport Cargo.toml (+tokio-stream); `crates/transport/src/notifications/{mod.rs,notifier.rs,record.rs,notification_service.rs}`; transport lib.rs.

- [ ] notifier.rs: `pub(crate) struct Notifier` (Mutex registry) + `register(recipient, tx)` + `broadcast(recipient, &Notification)` (prune dead). `pub(crate) struct NotifRefs{project_id,task_id,comment_id: Option<String>}`. `pub(crate) async fn emit(store, notifier: &Notifier, recipient, kind: NotificationType, actor, message, refs)` — no-op self; persist; build pb::Notification; broadcast. Unit test (register + emit → channel receives; self no-op).
- [ ] record.rs: NotificationRecord + read/to_proto/notifications_for_recipient (created_at desc) / unread_count_for / load_notification.
- [ ] notification_service.rs: list_notifications (caller-scoped, paginated), unread_count, mark_read (only caller's ids), mark_all_read, stream_notifications (register channel → `ConnectResponse<StreamBody<UnboundedReceiverStream<...>>>`). `notification_router(store, notifier)`.

## Task 4: wire emits into existing services

**Files:** comments/comment_service.rs, work/task_service.rs, projects/project_service.rs, users/directory_service.rs (+ auth activate).

- [ ] Each emitting handler: add `notifier: Option<Extension<Arc<Notifier>>>` extractor + turbofish entry; after the successful mutation, if Some, call `emit(...)`:
  - comment create → Mention to each new valid mention (except self); update → newly-added mentions.
  - task create → TaskAssigned to each assignee (except self); update → newly-added assignees.
  - project add_member → ProjectMemberAdded; transfer → OwnershipTransferred to new owner.
  - user activate → AccountApproved to the activated user.

## Task 5: app — construct Notifier + layer globally + merge router

**Files:** app main/router. Build `Arc<Notifier>`, `.layer(Extension(notifier))` on the merged router, merge `notification_router(store, notifier)`.

## Task 6: integration test + verify

**Files:** `crates/transport/tests/notification_flow.rs` (Notifier layered).

- [ ] Add member → recipient gets ProjectMemberAdded; mention in comment → mentioned gets Mention; assign task → assignee gets TaskAssigned; self-actions no-op. List caller-scoped + newest-first + paginated; unread count; mark_read (one) + mark_all_read; another user's notifications invisible. `cargo test --workspace` (rerun-safe) + clippy. Commit. Don't push.
