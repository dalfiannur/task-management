# Project Export — Flow Design

**Date:** 2026-08-20
**Status:** approved, ready for planning

## Goal

Let a team take a project out of the application as a whole — work, notes, and
files — in a form that still means something once it is outside.

This is not a new capability so much as an unpaid debt. ARCHITECTURE_BIBLE §1
promises to "menyimpan tugas, jadwal, catatan, dan file sebuah proyek sebagai
satu kesatuan yang bisa diekspor"; the invariant table promises data "dapat
diekspor ke format terbuka yang tetap bermakna di luar aplikasi"; VISION lists
exportability among the properties that do not change. There is not one export
RPC in the twelve protos.

STD-0007 governs the shape of whatever we ship: a published data contract MUST
carry a version field.

## Scope

- A full-project archive: one ZIP containing a versioned JSON document, a flat
  task CSV, and the original bytes of every media file.
- A task CSV on its own, for the spreadsheet case.
- A durable job queue in Postgres, an in-process worker, and a notification when
  the archive is ready or has failed.
- Owner/admin-only, entered from the project header where the other owner
  actions already live.

Out of scope, deliberately:

- Cross-project or whole-account export.
- Import — reading an archive back in.
- Scheduled or recurring exports.
- PDF/XLSX output; encrypted archives.
- Recording exports in the project activity feed (see below — this is a
  decision, not an omission).

## Decision: the archive carries the bytes

An export that lists a file without containing it is a manifest, not an archive:
the moment the S3 bucket is gone, so is the work it points at, and the invariant
that an artifact must "tetap bermakna di luar satu sesi aplikasi" fails.

Rejected alternatives:

- **Metadata only.** Small, deterministic, one text file. But it is lossless
  about tasks and lossy about everything a team actually attached to them.
- **Metadata plus time-limited signed URLs.** Retrievable by hand, and rotten
  after the TTL. An artifact with an expiry date is not portability.

The cost is paid in full and stated plainly: carrying bytes is what forces the
job queue, the worker, the temporary disk file, and two new `Storage` methods.
None of that exists for a metadata-only export.

## Decision: two paths, matched to two weights

`FULL_ZIP` goes through the queue. `TASKS_CSV` does not — a flat task list for
even the largest project is a few hundred kilobytes, so it is a plain unary RPC
returning a string, which the frontend wraps in a Blob and downloads at once.

Pushing the CSV through the queue would mean waiting for a notification to
receive a file that should appear in 200ms.

The honest cost: this is **two mechanisms, not one**. The alternative is a single
mechanism that is wrong at one end — either a queue for a trivial file, or a
memory-resident response for a 300MB one.

## Decision: an async job, not a streamed download

Rejected alternatives:

- **Ticket plus streaming GET.** A Connect RPC issues a single-use ticket; the
  browser redeems it at a plain axum route that streams the ZIP. Cheaper, no job
  table, no worker. Rejected because it adds the first non-Connect HTTP surface
  in the router, holds a request open for the whole assembly, and loses
  everything if the connection drops.
- **A unary RPC returning `bytes`.** No new surface at all, testable with the
  existing flow-test harness — and it requires the whole archive to fit in
  server memory and browser memory at once. Defensible for metadata; indefensible
  once media bytes are in scope.
- **In-memory job state, no table.** Least code. A restart erases running jobs
  with no trace, and no export history can be shown — against the provenance
  invariant.

A useful property falls out of this choice: the finished archive is downloaded
via a **presigned S3 GET**, exactly the pattern `GetMediaDownloadUrl` already
uses. S3 does the streaming. So the async design avoids the very cost that sank
the ticket approach — the entire surface stays Connect.

## Consequences before the design

Two things this feature is the first to need, both real work that no alternative
avoids:

1. **There is no `tokio::spawn` anywhere in `backend-rs`.** No background task
   precedent exists. This introduces one.
2. **The `Storage` trait has no read and no write.** It carries `presign_put`,
   `presign_get`, `head`, `delete`; uploads today go browser → S3 directly. To
   assemble an archive the server must read object bytes and write the result
   back. The trait grows two methods, and both need an implementation in
   `s3_impl.rs` *and* in the test fake, or the worker cannot be tested without a
   live S3.

There are exactly two `impl Storage` in the repo — `s3_impl.rs` and
`FakeStorage` in `transport/tests/media_flow.rs` — so the blast radius is known.

## The archive

```
export.json          versioned contract, lossless
tasks.csv            the same flat projection the sync path returns
media/<id>-<name>    original bytes
```

`export.json` satisfies STD-0007 with a root `schema_version`:

```json
{
  "schema_version": 1,
  "exported_at": "2026-08-20T09:00:00Z",
  "exported_by": { "id": "…", "name": "…" },
  "project":  { … },
  "users":    [ { "id": "…", "name": "…" } ],
  "modules":  [ … ],
  "tasks":    [ { …, "parent_id": …, "blocked_by_ids": […],
                  "label_ids": […], "assignee_ids": […] } ],
  "labels":   [ … ],
  "comments": [ … ],
  "pages":    [ … ],
  "activity": [ … ],
  "media":    [ { "id": …, "file_name": …, "mime": …, "size": …,
                  "task_id": …, "path": "media/…" } ],
  "media_skipped": [ { "id": …, "file_name": …, "reason": "missing" } ]
}
```

The `users` block is what makes the archive stand alone. Without it every
`assignee_id` is a dead integer outside the system, and the file fails the test
the invariant sets for it.

**PII decision: `users` carries `id` and `name` only.** No phone number, even
though `User` has one and the owner can read it in the Members tab. A single
click that yields a file containing the team's contact list is a different kind
of artifact from an archive of work, and that file lives outside the
application's control permanently.

`tasks.csv` columns: `id, module, title, status, priority, assignees, labels,
start_date, due_date, completed_at, parent_id, blocked_by, created_at,
created_by`. People and labels appear by name, not id — the destination is a
spreadsheet a human reads.

Compression: deflate for `export.json` and `tasks.csv`, **store** for `media/`.
Media is already compressed; recompressing it burns CPU for nothing.

### Assembly order, and why it is backwards

The archive is written with `async_zip` into a temporary file on disk, then
uploaded in one call (`ByteStream::from_path`, never held whole in memory). The
order is deliberately not the order things are read:

1. Gather **all JSON data in one transaction**, so the document is internally
   consistent rather than a smear across the minutes the copy takes.
2. Copy each media object's bytes into its `media/` entry, incrementing
   `file_done`.
3. **Then** write `export.json` and `tasks.csv`.

Because the manifest is written last, it lists the files that actually made it
in. An object that vanished from S3 mid-run neither fails the export nor leaves
a lying entry: it is skipped and recorded under `media_skipped`.

The temporary file costs disk equal to the finished archive. It is removed by a
guard that also runs on the error path. `deploy/README.md` should say so.

## Model

`export_job`, raw sqlx in `persistence/src/export.rs`, mirroring `search.rs`: a
job is an operational record, not a domain entity, so it stays outside the Arke
component model.

```sql
CREATE TABLE IF NOT EXISTS export_job (
  id           bigserial PRIMARY KEY,
  project_id   text NOT NULL,
  requested_by text NOT NULL,
  status       text NOT NULL,        -- pending | running | ready | failed | expired
  storage_key  text,                 -- exports/<project_id>/<job_id>.zip
  size_bytes   bigint,
  file_total   int  NOT NULL DEFAULT 0,
  file_done    int  NOT NULL DEFAULT 0,
  attempts     int  NOT NULL DEFAULT 0,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz
);
```

`migrate()` runs at boot alongside the search migration. **The trap documented in
`search.rs` applies here identically:** `CREATE TABLE IF NOT EXISTS` silently
does nothing on a database that already has the table, so any column added later
needs its own `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

### The worker

Lives in `transport/src/export/worker.rs`, following `search/indexer.rs` —
index writing already lives in transport rather than a crate of its own.
`app/src/main.rs` spawns it once at boot. It wakes on a `tokio::sync::Notify`
fired by `StartExport` (so a job starts immediately rather than at the next
poll) and on a 60-second tick as a safety net.

Claiming is one statement, and stays correct if the deployment ever runs more
than one instance:

```sql
UPDATE export_job SET status='running', attempts=attempts+1, updated_at=now()
WHERE id = (SELECT id FROM export_job WHERE status='pending'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING *
```

**One job at a time.** Export is heavy I/O on a small single instance;
parallelism here only moves the congestion onto the API path other people are
using.

**Restart recovery:** at boot, jobs left `running` return to `pending` — whatever
was working on them died with the process. At `attempts >= 3` a job becomes
`failed` with its reason recorded, so a job that always explodes stops looping.

**Retention:** `expires_at = ready_at + 7 days`. The same worker tick sweeps
expired jobs: delete the S3 object, set `expired`. The row stays as the trace
that an export was made, by whom and when — which is what the provenance
invariant asks for, and what makes the UI able to say "this existed and was
cleaned up" instead of showing nothing.

**Dedupe:** at most one `pending`/`running` job per project. A second request
returns the running job rather than queueing another.

### Project deletion

`DeleteProject` already cascades through modules, tasks, media and the search
index. Export must join that cascade, in two parts:

- Rows in `export_job` for the project are deleted, and any archive object still
  in S3 is deleted with them. An archive is a copy of a project that was asked to
  disappear; leaving it downloadable for up to seven days after would be the
  cascade quietly not meaning what it says.
- A job that is `running` when its project is deleted finds its data gone
  mid-assembly. It fails with a recorded reason rather than panicking, and its
  temporary file is removed by the same guard as any other error path.

This is the one place the export feature reaches back into an existing handler.

## Backend contract

### Proto — `proto/export.proto`, package `sedjiwa.tasks.export.v1`

```proto
service ExportService {
  rpc ExportTasksCsv(ExportTasksCsvRequest) returns (ExportTasksCsvResponse);
  rpc StartExport(StartExportRequest) returns (ExportJob);
  rpc ListExports(ListExportsRequest) returns (ListExportsResponse);
  rpc GetExportDownloadUrl(GetExportDownloadUrlRequest)
      returns (GetExportDownloadUrlResponse);
}

enum ExportStatus {
  EXPORT_STATUS_UNSPECIFIED = 0;
  PENDING = 1; RUNNING = 2; READY = 3; FAILED = 4; EXPIRED = 5;
}

message ExportJob {
  string id = 1;
  string project_id = 2;
  string requested_by = 3;
  ExportStatus status = 4;
  optional int64 size_bytes = 5;
  int32 file_total = 6;
  int32 file_done = 7;
  optional string error = 8;
  string created_at = 9;
  string updated_at = 10;
  optional string expires_at = 11;
}
```

`ExportTasksCsvResponse` carries `csv` and `file_name`, and never touches the job
table.

### Storage trait

```rust
async fn get_stream(&self, key: &str) -> Result<ByteStream>;
async fn put_file(&self, key: &str, path: &Path, mime: &str) -> Result<u64>;
```

### Authorization

`require_project` then `require_owner_or_admin`, the helpers already in
`project_service.rs`, on all four RPCs.

The one that is easy to miss: **the check is repeated at
`GetExportDownloadUrl`**, not only at `StartExport`. Ownership can move through
`TransferProjectOwnership` between the two moments, and a former owner must not
walk away with the archive of a project that is no longer theirs. The presigned
URL lives one hour and can be reissued while the job is `ready`.

### Notifications

`NotificationType` gains `EXPORT_READY = 6` and `EXPORT_FAILED = 7`;
`Notification` gains `optional string export_id = 10`.

The recipient is **the requester only**, not the project. An export is that
person's errand; broadcasting it turns the notification panel into noise. Since
`StreamNotifications` already runs, a finished archive announces itself with no
polling — which is also why `ListExports` can be polled lazily while the dialog
is open instead of being the primary status channel.

### Deliberately not in the activity feed

The `export_job` row — who, when, how large — is already the trace the
provenance invariant requires, and it outlives the archive. The activity feed
tells the story of *changes to the work*; folding reads into it dilutes the
thing that makes the feed worth reading.

## File structure

| New file | Responsibility |
|---|---|
| `persistence/src/export.rs` | Table, migration, job queries. Mirrors `search.rs` |
| `transport/src/export/record.rs` | `ExportJobRecord` ↔ row |
| `transport/src/export/archive.rs` | JSON/CSV/ZIP assembly. Pure enough to test alone |
| `transport/src/export/export_service.rs` | Four RPCs + authorization |
| `transport/src/export/worker.rs` | Claim loop, retention sweep |
| `app/src/main.rs` | Spawn the worker at boot |
| `app/src/router.rs` | Register `ExportService` |
| `transport/src/projects/project_service.rs` | *(touched)* extend the delete cascade to jobs and archives |
| `features/exports/api/hooks.ts` | connect-query hooks + mappers |
| `features/exports/components/export-dialog.tsx` | The dialog |

`archive.rs` is split from `worker.rs` on purpose: assembly is a function over
in-memory data and can be checked directly, while the worker is scheduling. Fused
together, the only way to assert on an archive's contents would be to run the
whole loop.

## Frontend

A new feature directory `src/features/exports/`. The entry point hangs off
`project-detail-header.tsx`, where the owner actions already gather and where
`TransferOwnershipDialog` is the exact precedent: one menu item, one dialog. No
new route, no new tab. The item renders for owner or admin only — the server
enforces, the UI merely stops offering what would be refused.

The dialog holds two buttons of different weight, plus history:

- **Download task CSV** — sync RPC, Blob, `createObjectURL` → anchor click →
  `revokeObjectURL`.
- **Build full archive (.zip)** — `StartExport`. While a job is running the
  button is disabled and says so; the server dedupes anyway, but a button that
  still invites clicks is a small lie about what is happening.
- **Recent exports** — status, `file_done/file_total`, size, expiry, and a
  download button when `ready`. `failed` shows its error; `expired` renders
  greyed with no button, so it is clear the archive existed and was swept rather
  than silently absent.

`refetchInterval` lives **only** while a job is `pending`/`running` and stops
when none is. An arriving `EXPORT_READY` or `EXPORT_FAILED` invalidates the
export query and raises a toast — success or failure both report themselves even
when the dialog is closed. A failure that only appears next time someone happens
to reopen the dialog is a failure nobody learns about.

**Inherited deployment trap:** presigned URLs are absolute, signed with
`S3_ENDPOINT`. `deploy/README.md` already explains why `HOST_LAN_IP` exists;
archive downloads are subject to exactly that constraint and fail exactly that
way when the endpoint is unreachable from the browser.

## Verification

| Layer | What it covers |
|---|---|
| Unit — `archive.rs` | `schema_version` always present; `users` carries only `id`+`name` (PII regression); `media_skipped` populated when an object is missing; CSV columns and escaping (titles with commas and quotes) |
| Unit — `export.rs` | Status transitions: claim, `running` → `pending` at boot, `attempts >= 3` → `failed`, expiry sweep |
| Handler — `tests/export_flow.rs` | Guard matrix, positive and negative, on all four RPCs: member → `PERMISSION_DENIED`, owner → allowed, admin → allowed. **And the case most likely to be missed:** owner requests an archive, ownership is transferred, the former owner calls `GetExportDownloadUrl` → refused |
| Handler | Side-effect smoke: a finished job emits `EXPORT_READY` to the requester, and only to the requester |
| Frontend | `api/` mappers via `createRouterTransport`; menu item hidden for a member |

`FakeStorage` in `transport/tests/media_flow.rs` grows with the trait.

Gates: `cargo test` and `cargo clippy` in the backend; `bun run tsc --noEmit`,
`bun run lint`, `vite build` in the frontend. `buf generate` must run after the
new proto before the frontend compiles.

The record from the last two sub-projects is that bugs ship past every one of
these gates and past code review, surfacing only when someone drives the app. So
a browser pass is a numbered task, and must cover at least:

- A project with media: start an archive, watch progress move, download it, open
  the ZIP, confirm `export.json` parses and `media/` holds the files.
- A project with no media at all: the archive still builds and is valid.
- Restart the backend mid-run; confirm the job returns to `pending` and finishes.
- A member opening the project sees no export entry point.
- CSV download from a project whose task titles contain commas and quotes, opened
  in a spreadsheet.
- Delete a project that has a ready archive; confirm the archive is gone and the
  download no longer resolves.
