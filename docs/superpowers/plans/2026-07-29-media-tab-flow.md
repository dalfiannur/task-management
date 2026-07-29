# Media Tab (File Manager) Flow — Implementation Plan (backend, per-op Store + S3)

> **For agentic workers:** first flow with external storage. S3 behind a `Storage` trait (testable with a fake). Verified against Postgres.

**Goal:** Backend media per [spec](../specs/2026-07-29-project-media-tab-flow-design.md): presigned-upload files per project + task↔media links. New `MediaService` (8 rpcs).

**Architecture:** S3/RustFS behind a `storage::Storage` trait (presign PUT/GET offline; head/delete async) injected as an extension — real `S3Storage` (rust-s3) in the app, a fake in tests. Two-step upload: CreateMediaUpload (Pending row + presign PUT) → client PUT → CompleteMediaUpload (HEAD verify → Ready + real size). Downloads via short-TTL presigned GET.

**Scope/deferrals:** activity emit (§5) + orphan-Pending GC (§8) deferred. Size/MIME allow-list deferred (§8.2 — validate later). Guards: upload/list/link = member; download/list = member/admin; delete = uploader/owner/admin.

**Decisions:** media/link ids = pid strings. storage_key = `{project_id}/{uuid}/{file_name}` (uuid dep). status stored as indexed String. List/ListTaskMedia return only Ready files. Link validates task.project == media.project (task→module→project via `crate::work::task_project_id`). App always starts (S3 config defaults to dev values; presign is offline, only head/delete hit network).

---

## Task 1: storage crate — Storage trait + S3 impl

**Files:** Create `crates/storage/{Cargo.toml,src/lib.rs}`; add to workspace members + `uuid` workspace dep.

- [ ] `#[async_trait] trait Storage: Send+Sync { fn presign_put(key,mime,ttl)->Result<String>; fn presign_get(key,ttl)->Result<String>; async fn head(key)->Result<Option<u64>>; async fn delete(key)->Result<()>; }`
- [ ] `S3Config` from env (S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_REGION/S3_FORCE_PATH_STYLE, dev defaults) + `S3Storage` (rust-s3 Bucket). `new_key(project_id, file_name) -> String` helper (uuid).
- [ ] `cargo build -p storage` (confirm rust-s3 presign API sync vs async; adapt trait).

## Task 2: domain — media components + status

**Files:** Create `crates/domain/src/media.rs`; modify lib.rs.

- [ ] `MediaFileInfo{ #[pg(index)] project_id, file_name, original_file_name, #[pg(index)] mime_type, size:i64, storage_key, #[pg(index)] uploaded_by, #[pg(index)] created_at, status:String }`; `TaskMediaLinkData{ #[pg(index)] media_file_id, #[pg(index)] task_id, #[pg(index)] project_id }`; `MediaStatus{Pending,Ready}` (as_str/parse/to_proto/from_proto; PENDING=1,READY=2) + test. register_all.

## Task 3: proto — media.proto

**Files:** `proto/media.proto` (`package sedjiwa.tasks.media.v1`) per spec §4; build.rs.
- [ ] `cargo build -p transport`.

## Task 4: work — expose task_project_id

**Files:** `crates/transport/src/work/mod.rs`.
- [ ] `pub(crate) async fn task_project_id(store, task_id) -> Result<Option<String>>` (task→module→project via load_task/load_module).

## Task 5: transport — media records + MediaService

**Files:** Create `crates/transport/src/media/{mod.rs,record.rs,media_service.rs}`; modify transport lib.rs + Cargo.toml (storage dep).

- [ ] mod.rs: guards (require_auth, require_member, require_uploader_owner_or_admin), StoreExt + `StorageExt = Extension<Arc<dyn Storage>>`, internal/parse_pid.
- [ ] record.rs: MediaRecord + read/to_proto/load_media/media_for_project(Ready)/ + link helpers (link_pids_for_media, media_ids_for_task, link_exists).
- [ ] media_service.rs handlers:
  - create_media_upload (member; storage_key; create Pending; presign PUT; return {media_file_id, upload_url, storage_key}).
  - complete_media_upload (member; HEAD→size; set Ready; return MediaFile).
  - list_project_media (member; Ready only).
  - get_media_download_url (member; presign GET + expires_in).
  - delete_media_file (uploader/owner/admin; storage.delete + row delete + all links delete).
  - link_task_media (member; same-project; idempotent).
  - unlink_task_media (member; idempotent).
  - list_task_media (member; Ready files linked to task).
  - media_router(store, storage).
- [ ] `cargo build -p transport`.

## Task 6: app — wire S3Storage + integration test + verify

**Files:** app main/router (construct S3Storage, merge media_router); `crates/transport/tests/media_flow.rs` (fake Storage).

- [ ] main: build `Arc<dyn Storage> = Arc::new(S3Storage::from_env()?)`; pass to media_router.
- [ ] Test with a fake Storage (records puts/heads/deletes): full upload lifecycle (create→Pending, list excludes Pending, complete→Ready+size, list includes), download url, delete (removes row + links + calls storage.delete), link/unlink (same-project validation + idempotent), list_task_media; member/uploader/owner/admin guards.
- [ ] `cargo test --workspace` (rerun-safe) + clippy clean.
- [ ] Commit `feat(backend-rs): project Media (files + task links) on per-op Store + S3`. Don't push.
