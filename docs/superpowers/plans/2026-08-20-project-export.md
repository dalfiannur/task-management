# Project Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project owner can take a project out of the app — instantly as a task CSV, and as a full ZIP archive (versioned JSON + original media bytes) built by a background worker that notifies them when it is ready.

**Architecture:** Two paths matched to two weights. `ExportTasksCsv` is a plain unary Connect RPC that returns a string. `StartExport` writes a row to an `export_job` table in Postgres; an in-process Tokio worker claims it, assembles a ZIP into a temp file, uploads it to S3, and emits a notification. The finished archive is downloaded through a presigned S3 GET, so the whole surface stays Connect.

**Tech Stack:** Rust (axum + connectrpc-axum, Arke ECS via `persistence::Store`, raw sqlx for the job table, `rust-s3`, `zip` crate inside `spawn_blocking`), React 19 + connect-query + Jotai on the frontend.

**Spec:** `docs/superpowers/specs/2026-08-20-project-export-design.md`

---

## Orientation for someone new to this codebase

Read these before Task 1. Each is short and each is a pattern you will copy:

- `apps/backend-rs/crates/transport/src/labels/` — the smallest complete service (mod.rs helpers, record.rs, label_service.rs). Your `export/` module mirrors its shape.
- `apps/backend-rs/crates/persistence/src/search.rs` — the precedent for a raw sqlx table living outside the Arke component model. Your `export_job` table mirrors it.
- `apps/backend-rs/crates/transport/tests/media_flow.rs` — the flow-test harness (fake Storage, JWT minting, `oneshot` calls). You will copy its helpers verbatim.

Three facts that will otherwise cost you an hour each:

1. `Store::query::<T, R>(predicate, map)` selects entities by component `T`'s table but materializes **all** their components, so the `map` closure can read other components off the same `World`. See `projects/record.rs::read_project`.
2. There is no project-wide `WHERE` for most components. Existing code (`labels_for_project`) queries all rows and filters in the closure. Follow that; do not invent SQL.
3. `sqlx` here is built **without** the `time`/`chrono` features. Timestamps in the new table are `text` holding RFC3339 UTC strings — which is also what every domain component already stores, and which compares correctly with `<=` for the expiry sweep.

## File structure

| File | Responsibility |
|---|---|
| `apps/backend-rs/proto/export.proto` | The Connect contract |
| `crates/transport/src/export/mod.rs` | Module wiring + auth/parse helpers |
| `crates/transport/src/export/model.rs` | `ProjectSnapshot` and its `*Out` structs — plain serde data, no proto, no components |
| `crates/transport/src/export/gather.rs` | Store queries → `ProjectSnapshot` |
| `crates/transport/src/export/csv.rs` | `ProjectSnapshot` → CSV string. Pure |
| `crates/transport/src/export/json.rs` | `ProjectSnapshot` → `export.json` string. Pure |
| `crates/transport/src/export/archive.rs` | ZIP assembly: temp file, media copies, upload |
| `crates/transport/src/export/record.rs` | `ExportJobRow` → proto |
| `crates/transport/src/export/export_service.rs` | The four RPCs + authorization |
| `crates/transport/src/export/worker.rs` | Claim loop, progress, retention sweep |
| `crates/persistence/src/export.rs` | Table, migration, job queries |
| `crates/transport/tests/export_flow.rs` | Guard matrix + end-to-end flows |
| `apps/frontend/src/features/exports/*` | Hooks, types, the dialog |

This splits the spec's single `archive.rs` into `model` + `gather` + `csv` + `json` + `archive`. The spec's reason for splitting assembly from scheduling applies one level down too: gathering is queries, serializing is pure, zipping is I/O, and fusing them means the only way to assert on a CSV column is to run a worker.

---

# Phase 1 — The CSV path

Ships on its own: an owner can download a task CSV. No job table, no worker, no S3.

## Task 1: The proto contract

**Files:**
- Create: `apps/backend-rs/proto/export.proto`
- Modify: `apps/backend-rs/crates/transport/build.rs`

- [ ] **Step 1: Write the proto**

```proto
syntax = "proto3";
package sedjiwa.tasks.export.v1;

// Taking a project out of the app.
// See docs/superpowers/specs/2026-08-20-project-export-design.md.
service ExportService {
  // Synchronous: a flat task list is small enough to return inline.
  rpc ExportTasksCsv(ExportTasksCsvRequest) returns (ExportTasksCsvResponse);
}

message ExportTasksCsvRequest { string project_id = 1; }
message ExportTasksCsvResponse {
  string csv = 1;
  string file_name = 2;
}
```

- [ ] **Step 2: Register it in the build**

In `crates/transport/build.rs`, add `"../../proto/export.proto",` to the array passed to `compile_protos` (after `"../../proto/search.proto",`), and add the matching rerun line at the bottom:

```rust
println!("cargo:rerun-if-changed=../../proto/export.proto");
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/backend-rs && cargo build -p transport`
Expected: success. The generated types now exist at `crate::sedjiwa::tasks::export::v1`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/proto/export.proto apps/backend-rs/crates/transport/build.rs
git commit -m "feat(export): add the ExportService proto contract"
```

## Task 2: The snapshot model

A plain data shape, separate from proto and from Arke components, because it is what gets written to disk and read outside the system.

**Files:**
- Create: `apps/backend-rs/crates/transport/src/export/model.rs`
- Create: `apps/backend-rs/crates/transport/src/export/mod.rs`

- [ ] **Step 1: Write `model.rs`**

```rust
//! What one project looks like on its way out of the app. Deliberately neither
//! proto nor Arke components: this is the shape that lands on disk and is read
//! by people who do not have this codebase.

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct ProjectSnapshot {
    pub project: ProjectOut,
    /// Everyone referenced anywhere in the archive. Id and name only — see the
    /// PII decision in the spec.
    pub users: Vec<UserOut>,
    pub modules: Vec<ModuleOut>,
    pub tasks: Vec<TaskOut>,
    pub labels: Vec<LabelOut>,
    pub comments: Vec<CommentOut>,
    pub pages: Vec<PageOut>,
    pub activity: Vec<ActivityOut>,
    pub media: Vec<MediaOut>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct ProjectOut {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub owner_id: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct UserOut {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ModuleOut {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TaskOut {
    pub id: String,
    pub module_id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub completed_at: Option<String>,
    pub sort_order: i32,
    pub assignee_ids: Vec<String>,
    pub label_ids: Vec<String>,
    pub parent_id: Option<String>,
    pub blocked_by_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LabelOut {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CommentOut {
    pub id: String,
    pub task_id: String,
    pub author_id: String,
    pub content: String,
    pub mentioned_user_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PageOut {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub content: String,
    pub sort_order: i32,
    pub created_by: String,
    pub last_edited_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityOut {
    pub id: String,
    pub actor_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaOut {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub uploaded_by: String,
    pub created_at: String,
    pub task_ids: Vec<String>,
    /// Storage key — needed to fetch the bytes, dropped before serialization in
    /// Phase 2 (`path` replaces it in the archive manifest).
    #[serde(skip)]
    pub storage_key: String,
}
```

- [ ] **Step 2: Write `mod.rs`**

```rust
//! Export: taking a project out of the app.
//! See docs/superpowers/specs/2026-08-20-project-export-design.md.

mod csv;
mod gather;
mod model;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

use crate::projects::record::{load_project, ProjectRecord};

pub(crate) type StoreExt = Extension<Arc<Store>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("project not found"))
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

pub(crate) async fn require_project(store: &Store, pid: i64) -> Result<ProjectRecord, ConnectError> {
    load_project(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))
}

/// Export is a consequential operation: one action that carries a whole project
/// out of the app. Same gate as delete/transfer.
pub(crate) fn require_owner_or_admin(
    auth: &AuthUser,
    project: &ProjectRecord,
) -> Result<(), ConnectError> {
    if auth.is_admin() || project.owner_id == auth.id {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("owner or admin only"))
    }
}

/// Filename-safe stem from a project name: "Toko Bunga / Q3" → "toko-bunga-q3".
/// Empty or all-punctuation names fall back to "project".
pub(crate) fn file_slug(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        "project".to_string()
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::file_slug;

    #[test]
    fn slug_is_filename_safe() {
        assert_eq!(file_slug("Toko Bunga / Q3"), "toko-bunga-q3");
        assert_eq!(file_slug("  spaced  out  "), "spaced-out");
        assert_eq!(file_slug("///"), "project");
        assert_eq!(file_slug(""), "project");
    }
}
```

`csv` and `gather` do not exist yet, so this will not compile until Task 3. That is expected — Task 3's test is the first thing that runs.

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/transport/src/export/
git commit -m "feat(export): add the project snapshot model and module helpers"
```

## Task 3: The CSV serializer (TDD)

**Files:**
- Create: `apps/backend-rs/crates/transport/src/export/csv.rs`

- [ ] **Step 1: Write the failing test**

Create `csv.rs` containing only this test module plus `use` lines:

```rust
//! ProjectSnapshot → the flat task CSV. Pure: no store, no I/O.

use std::collections::HashMap;

use super::model::ProjectSnapshot;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::model::{LabelOut, ModuleOut, TaskOut, UserOut};

    fn task(id: &str, title: &str) -> TaskOut {
        TaskOut {
            id: id.into(),
            module_id: "10".into(),
            title: title.into(),
            description: String::new(),
            status: "todo".into(),
            priority: "high".into(),
            start_date: None,
            due_date: Some("2026-09-01".into()),
            completed_at: None,
            sort_order: 0,
            assignee_ids: vec!["1".into(), "2".into()],
            label_ids: vec!["7".into()],
            parent_id: None,
            blocked_by_ids: vec![],
            created_at: "2026-08-01T00:00:00Z".into(),
            updated_at: "2026-08-01T00:00:00Z".into(),
            created_by: "1".into(),
        }
    }

    fn snapshot(tasks: Vec<TaskOut>) -> ProjectSnapshot {
        ProjectSnapshot {
            users: vec![
                UserOut { id: "1".into(), name: "Rina".into() },
                UserOut { id: "2".into(), name: "Budi".into() },
            ],
            modules: vec![ModuleOut {
                id: "10".into(),
                name: "Persiapan".into(),
                description: String::new(),
                sort_order: 0,
            }],
            labels: vec![LabelOut { id: "7".into(), name: "urgent".into(), color: "#ff0000".into() }],
            tasks,
            ..Default::default()
        }
    }

    #[test]
    fn header_then_one_row_per_task_with_names_not_ids() {
        let out = tasks_csv(&snapshot(vec![task("100", "Pasang spanduk")]));
        let mut lines = out.lines();
        assert_eq!(lines.next().unwrap(), CSV_HEADER);
        let row = lines.next().unwrap();
        assert!(row.starts_with("100,Persiapan,Pasang spanduk,todo,high,"), "got: {row}");
        assert!(row.contains("Rina; Budi"), "assignees by name: {row}");
        assert!(row.contains("urgent"), "labels by name: {row}");
        assert!(lines.next().is_none(), "exactly one data row");
    }

    #[test]
    fn fields_with_commas_quotes_and_newlines_are_rfc4180_quoted() {
        let out = tasks_csv(&snapshot(vec![task("101", "Beli \"paku\", semen\ndan cat")]));
        let body = out.split_once('\n').unwrap().1;
        assert!(
            body.contains("\"Beli \"\"paku\"\", semen\ndan cat\""),
            "quotes doubled, field wrapped: {body}"
        );
    }

    #[test]
    fn unknown_ids_and_missing_dates_render_empty_not_raw_ids() {
        let mut t = task("102", "Yatim");
        t.assignee_ids = vec!["999".into()];
        t.label_ids = vec![];
        t.due_date = None;
        t.module_id = "404".into();
        let out = tasks_csv(&snapshot(vec![t]));
        let row = out.lines().nth(1).unwrap();
        assert!(row.starts_with("102,,Yatim,"), "unknown module → empty: {row}");
        assert!(!row.contains("999"), "unresolved user id must not leak: {row}");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend-rs && cargo test -p transport export::csv`
Expected: FAIL to compile — `cannot find function tasks_csv`, `cannot find value CSV_HEADER`.

- [ ] **Step 3: Write the implementation**

Insert above the `#[cfg(test)]` block:

```rust
pub(crate) const CSV_HEADER: &str = "id,module,title,status,priority,assignees,labels,start_date,due_date,completed_at,parent_id,blocked_by,created_at,created_by";

/// RFC 4180: wrap in quotes when the value contains a comma, quote, CR or LF;
/// double any embedded quote.
fn field(v: &str) -> String {
    if v.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

fn names(ids: &[String], by_id: &HashMap<&str, &str>) -> String {
    ids.iter()
        .filter_map(|id| by_id.get(id.as_str()).copied())
        .collect::<Vec<_>>()
        .join("; ")
}

/// One row per task, in snapshot order. People and labels appear by name because
/// the destination is a spreadsheet a human reads; ids that resolve to nothing
/// are dropped rather than leaked as bare numbers.
pub(crate) fn tasks_csv(s: &ProjectSnapshot) -> String {
    let users: HashMap<&str, &str> = s.users.iter().map(|u| (u.id.as_str(), u.name.as_str())).collect();
    let labels: HashMap<&str, &str> = s.labels.iter().map(|l| (l.id.as_str(), l.name.as_str())).collect();
    let modules: HashMap<&str, &str> = s.modules.iter().map(|m| (m.id.as_str(), m.name.as_str())).collect();

    let mut out = String::from(CSV_HEADER);
    for t in &s.tasks {
        let cells = [
            t.id.clone(),
            modules.get(t.module_id.as_str()).copied().unwrap_or("").to_string(),
            t.title.clone(),
            t.status.clone(),
            t.priority.clone(),
            names(&t.assignee_ids, &users),
            names(&t.label_ids, &labels),
            t.start_date.clone().unwrap_or_default(),
            t.due_date.clone().unwrap_or_default(),
            t.completed_at.clone().unwrap_or_default(),
            t.parent_id.clone().unwrap_or_default(),
            t.blocked_by_ids.join("; "),
            t.created_at.clone(),
            users.get(t.created_by.as_str()).copied().unwrap_or("").to_string(),
        ];
        out.push('\n');
        out.push_str(&cells.iter().map(|c| field(c)).collect::<Vec<_>>().join(","));
    }
    out.push('\n');
    out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend-rs && cargo test -p transport export::csv`
Expected: 3 passed. (`gather` is still missing, so `cargo build` fails — the test target compiles the module tree, so if this errors on `gather`, temporarily comment `mod gather;` in `mod.rs`, run, and restore it in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/export/csv.rs
git commit -m "feat(export): serialize a snapshot to the task CSV"
```

## Task 4: Gathering the snapshot from the store

No unit test: every line of this is a store query, so the flow test in Task 6 is what proves it. Keep it dumb and readable.

**Files:**
- Create: `apps/backend-rs/crates/transport/src/export/gather.rs`

- [ ] **Step 1: Write `gather.rs`**

```rust
//! Store → ProjectSnapshot. One pass per component family, filtered in the
//! closure — the pattern every other record module here uses (`labels_for_project`).

use std::collections::{HashMap, HashSet};

use domain::activity::ActivityInfo;
use domain::comment::CommentInfo;
use domain::label::LabelInfo;
use domain::media::{MediaFileInfo, TaskMediaLinkData};
use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
use domain::page::{PageAudit, PageInfo};
use domain::project::{
    ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatusComponent,
};
use domain::task::{
    TaskAssignees, TaskAudit, TaskBlockedBy, TaskInfo, TaskLabels, TaskModuleRef, TaskParent,
};
use domain::user::UserProfile;
use persistence::Store;

use super::model::*;

/// Everything about one project, in one shot. Callers get a value they can
/// serialize; nothing here touches proto or the network.
pub(crate) async fn gather(store: &Store, project_id: &str) -> anyhow::Result<ProjectSnapshot> {
    let pid: i64 = project_id.parse()?;

    // --- project -----------------------------------------------------------
    let mut project = store
        .query::<ProjectName, ProjectOut>(Some(&format!("pid = {pid}")), |w, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| {
                    let name = w.get::<ProjectName>(*e)?;
                    let dates = w.get::<ProjectDates>(*e);
                    Some(ProjectOut {
                        id: p.to_string(),
                        name: name.value.clone(),
                        description: w
                            .get::<ProjectDescription>(*e)
                            .map(|d| d.value.clone())
                            .unwrap_or_default(),
                        status: w
                            .get::<ProjectStatusComponent>(*e)
                            .map(|s| s.value.clone())
                            .unwrap_or_default(),
                        owner_id: w
                            .get::<ProjectOwnerId>(*e)
                            .map(|o| o.value.clone())
                            .unwrap_or_default(),
                        start_date: dates.and_then(|d| d.start_date.clone()),
                        end_date: dates.and_then(|d| d.end_date.clone()),
                        member_ids: vec![],
                    })
                })
                .collect()
        })
        .await?
        .pop()
        .ok_or_else(|| anyhow::anyhow!("project {project_id} not found"))?;

    let pj = project_id.to_string();
    project.member_ids = store
        .query::<ProjectMembership, String>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(_, e)| w.get::<ProjectMembership>(*e))
                    .filter(|m| m.project_id == pj)
                    .map(|m| m.user_id.clone())
                    .collect()
            }
        })
        .await?;

    // --- modules -----------------------------------------------------------
    let mut modules = store
        .query::<ModuleProjectRef, ModuleOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter(|(_, e)| {
                        w.get::<ModuleProjectRef>(*e).is_some_and(|r| r.project_id == pj)
                    })
                    .filter_map(|(p, e)| {
                        Some(ModuleOut {
                            id: p.to_string(),
                            name: w.get::<ModuleName>(*e)?.value.clone(),
                            description: w
                                .get::<ModuleDescription>(*e)
                                .map(|d| d.value.clone())
                                .unwrap_or_default(),
                            sort_order: w.get::<ModuleOrder>(*e).map(|o| o.value).unwrap_or(0),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    modules.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));
    let module_ids: HashSet<String> = modules.iter().map(|m| m.id.clone()).collect();

    // --- tasks -------------------------------------------------------------
    let mut tasks = store
        .query::<TaskInfo, TaskOut>(None, {
            let mods = module_ids.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let info = w.get::<TaskInfo>(*e)?;
                        let module_id = w.get::<TaskModuleRef>(*e)?.module_id.clone();
                        if !mods.contains(&module_id) {
                            return None;
                        }
                        let audit = w.get::<TaskAudit>(*e);
                        Some(TaskOut {
                            id: p.to_string(),
                            module_id,
                            title: info.title.clone(),
                            description: info.description.clone(),
                            status: info.status.clone(),
                            priority: info.priority.clone(),
                            start_date: info.start_date.clone(),
                            due_date: info.due_date.clone(),
                            completed_at: audit.and_then(|a| a.completed_at.clone()),
                            sort_order: info.sort_order,
                            assignee_ids: w
                                .get::<TaskAssignees>(*e)
                                .map(|a| a.user_ids.clone())
                                .unwrap_or_default(),
                            label_ids: w
                                .get::<TaskLabels>(*e)
                                .map(|l| l.label_ids.clone())
                                .unwrap_or_default(),
                            parent_id: w.get::<TaskParent>(*e).map(|p| p.parent_id.clone()),
                            blocked_by_ids: w
                                .get::<TaskBlockedBy>(*e)
                                .map(|b| b.task_ids.clone())
                                .unwrap_or_default(),
                            created_at: audit.map(|a| a.created_at.clone()).unwrap_or_default(),
                            updated_at: audit.map(|a| a.updated_at.clone()).unwrap_or_default(),
                            created_by: audit.map(|a| a.created_by.clone()).unwrap_or_default(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    tasks.sort_by(|a, b| {
        a.module_id
            .cmp(&b.module_id)
            .then(a.sort_order.cmp(&b.sort_order))
            .then(a.id.cmp(&b.id))
    });
    let task_ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();

    // --- labels ------------------------------------------------------------
    let mut labels = store
        .query::<LabelInfo, LabelOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let l = w.get::<LabelInfo>(*e)?;
                        (l.project_id == pj).then(|| LabelOut {
                            id: p.to_string(),
                            name: l.name.clone(),
                            color: l.color.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    labels.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    // --- comments ----------------------------------------------------------
    let mut comments = store
        .query::<CommentInfo, CommentOut>(None, {
            let ids = task_ids.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let c = w.get::<CommentInfo>(*e)?;
                        ids.contains(&c.task_id).then(|| CommentOut {
                            id: p.to_string(),
                            task_id: c.task_id.clone(),
                            author_id: c.author_id.clone(),
                            content: c.content.clone(),
                            mentioned_user_ids: c.mentioned_user_ids.clone(),
                            created_at: c.created_at.clone(),
                            updated_at: c.updated_at.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- pages -------------------------------------------------------------
    let mut pages = store
        .query::<PageInfo, PageOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let pg = w.get::<PageInfo>(*e)?;
                        if pg.project_id != pj {
                            return None;
                        }
                        let a = w.get::<PageAudit>(*e);
                        Some(PageOut {
                            id: p.to_string(),
                            title: pg.title.clone(),
                            icon: pg.icon.clone(),
                            content: pg.content.clone(),
                            sort_order: pg.sort_order,
                            created_by: a.map(|a| a.created_by.clone()).unwrap_or_default(),
                            last_edited_by: a.map(|a| a.last_edited_by.clone()).unwrap_or_default(),
                            created_at: a.map(|a| a.created_at.clone()).unwrap_or_default(),
                            updated_at: a.map(|a| a.updated_at.clone()).unwrap_or_default(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    pages.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));

    // --- activity ----------------------------------------------------------
    let mut activity = store
        .query::<ActivityInfo, ActivityOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let a = w.get::<ActivityInfo>(*e)?;
                        (a.project_id == pj).then(|| ActivityOut {
                            id: p.to_string(),
                            actor_id: a.actor_id.clone(),
                            entity_type: a.entity_type.clone(),
                            entity_id: a.entity_id.clone(),
                            action: a.action.clone(),
                            summary: a.summary.clone(),
                            created_at: a.created_at.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    activity.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- media (ready only, with their task links) -------------------------
    let links = store
        .query::<TaskMediaLinkData, (String, String)>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(_, e)| w.get::<TaskMediaLinkData>(*e))
                    .filter(|l| l.project_id == pj)
                    .map(|l| (l.media_file_id.clone(), l.task_id.clone()))
                    .collect()
            }
        })
        .await?;
    let mut links_by_media: HashMap<String, Vec<String>> = HashMap::new();
    for (media_id, task_id) in links {
        links_by_media.entry(media_id).or_default().push(task_id);
    }

    let mut media = store
        .query::<MediaFileInfo, MediaOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let m = w.get::<MediaFileInfo>(*e)?;
                        (m.project_id == pj && m.status == "ready").then(|| MediaOut {
                            id: p.to_string(),
                            file_name: m.original_file_name.clone(),
                            mime_type: m.mime_type.clone(),
                            size: m.size,
                            uploaded_by: m.uploaded_by.clone(),
                            created_at: m.created_at.clone(),
                            task_ids: vec![],
                            storage_key: m.storage_key.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    for m in &mut media {
        m.task_ids = links_by_media.remove(&m.id).unwrap_or_default();
    }
    media.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- users: only those the archive actually references ------------------
    let mut referenced: HashSet<String> = project.member_ids.iter().cloned().collect();
    referenced.insert(project.owner_id.clone());
    for t in &tasks {
        referenced.extend(t.assignee_ids.iter().cloned());
        referenced.insert(t.created_by.clone());
    }
    for c in &comments {
        referenced.insert(c.author_id.clone());
    }
    for p in &pages {
        referenced.insert(p.created_by.clone());
        referenced.insert(p.last_edited_by.clone());
    }
    for a in &activity {
        referenced.insert(a.actor_id.clone());
    }
    for m in &media {
        referenced.insert(m.uploaded_by.clone());
    }
    referenced.remove("");

    let mut users = store
        .query::<UserProfile, UserOut>(None, move |w, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| {
                    let id = p.to_string();
                    if !referenced.contains(&id) {
                        return None;
                    }
                    // Id and name only. No phone, no email — the PII decision.
                    Some(UserOut {
                        id,
                        name: w.get::<UserProfile>(*e)?.display_name.clone(),
                    })
                })
                .collect()
        })
        .await?;
    users.sort_by(|a, b| a.id.cmp(&b.id));

    Ok(ProjectSnapshot {
        project,
        users,
        modules,
        tasks,
        labels,
        comments,
        pages,
        activity,
        media,
    })
}
```

- [ ] **Step 2: Verify it compiles and the CSV tests still pass**

Run: `cd apps/backend-rs && cargo test -p transport export::`
Expected: the 3 CSV tests plus `file_slug` pass; no warnings about unused imports.

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/transport/src/export/gather.rs
git commit -m "feat(export): gather a whole project into one snapshot"
```

## Task 5: The CSV RPC and its guard

**Files:**
- Create: `apps/backend-rs/crates/transport/src/export/export_service.rs`
- Modify: `apps/backend-rs/crates/transport/src/export/mod.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs`
- Modify: `apps/backend-rs/crates/app/src/router.rs`

- [ ] **Step 1: Write `export_service.rs`**

```rust
//! ExportService: the synchronous CSV path. Owner/admin only.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::csv::tasks_csv;
use super::gather::gather;
use super::{file_slug, internal, parse_pid, require_auth, require_owner_or_admin, require_project, StoreExt};
use crate::sedjiwa::tasks::export::v1 as pb;
use crate::sedjiwa::tasks::export::v1::export_service_connect::ExportServiceBuilder;

async fn export_tasks_csv(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ExportTasksCsvRequest>,
) -> Result<ConnectResponse<pb::ExportTasksCsvResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let project = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &project)?;

    let snapshot = gather(&store, &r.project_id).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::ExportTasksCsvResponse {
        csv: tasks_csv(&snapshot),
        file_name: format!("{}-tasks.csv", file_slug(&project.name)),
    }))
}

/// ExportService router; injects the Store as a request extension.
pub fn export_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ExportServiceBuilder::<()>::new()
        .export_tasks_csv::<_, (StoreExt, A, ConnectRequest<pb::ExportTasksCsvRequest>)>(
            export_tasks_csv,
        )
        .build()
        .layer(Extension(store))
}
```

- [ ] **Step 2: Wire the module up**

In `export/mod.rs`, add `mod export_service;` next to the other `mod` lines and `pub use export_service::export_router;` after them.

In `crates/transport/src/lib.rs`, add `mod export;` in the module list (alphabetical, before `mod labels;`) and `pub use export::export_router;` with the other re-exports.

In `crates/app/src/router.rs`, add `.merge(transport::export_router(store.clone()))` after the `.merge(transport::search_router(store.clone()))` line.

- [ ] **Step 3: Verify the whole backend builds**

Run: `cd apps/backend-rs && cargo build && cargo clippy --all-targets -- -D warnings`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/transport/src/export apps/backend-rs/crates/transport/src/lib.rs apps/backend-rs/crates/app/src/router.rs
git commit -m "feat(export): serve the task CSV over ExportService"
```

## Task 6: Flow test — the guard matrix and real CSV content

**Files:**
- Create: `apps/backend-rs/crates/transport/tests/export_flow.rs`

- [ ] **Step 1: Write the failing test**

```rust
//! End-to-end ExportService over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set (same convention as the other flow tests).

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const EXPORT: &str = "/sedjiwa.tasks.export.v1.ExportService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

async fn auth_mw(mut req: Request, next: Next) -> Response {
    if let Some(tok) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(u) = verify_jwt(tok.trim(), SECRET) {
            req.extensions_mut().insert(u);
        }
    }
    next.run(req).await
}

async fn setup() -> Option<(Router, Arc<Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::export_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn mk_user(store: &Store, name: &str) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("x{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: name.into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn csv_export_is_owner_gated_and_carries_task_rows() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let member = mk_user(&store, "Budi").await;
    let (to, tm) = (token(&owner), token(&member));

    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Export {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": project, "userId": member })).await;
    let module = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": project, "name": "Persiapan" })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/CreateTask"), &to,
        json!({ "moduleId": module, "title": "Beli \"paku\", semen", "assigneeIds": [member] })).await;

    // Member is refused: export is a consequential operation, not a read.
    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), Some(&tm), json!({ "projectId": project })).await;
    assert_ne!(st, StatusCode::OK, "member must not export");

    // No token at all is refused.
    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), None, json!({ "projectId": project })).await;
    assert_ne!(st, StatusCode::OK, "anonymous must not export");

    // Owner gets a CSV whose rows carry names, with the title properly quoted.
    let out = ok(&router, &format!("{EXPORT}/ExportTasksCsv"), &to, json!({ "projectId": project })).await;
    let csv = out["csv"].as_str().unwrap();
    assert!(out["fileName"].as_str().unwrap().ends_with("-tasks.csv"), "{out}");
    assert!(csv.starts_with("id,module,title,"), "header first: {csv}");
    assert!(csv.contains("\"Beli \"\"paku\"\", semen\""), "title quoted: {csv}");
    assert!(csv.contains("Persiapan"), "module by name: {csv}");
    assert!(csv.contains("Budi"), "assignee by name: {csv}");
}

#[tokio::test]
async fn csv_export_of_a_foreign_project_is_not_found_or_denied() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let outsider = mk_user(&store, "Asing").await;
    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &token(&owner), json!({ "name": format!("Sunyi {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();

    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), Some(&token(&outsider)), json!({ "projectId": project })).await;
    assert_ne!(st, StatusCode::OK, "a stranger must not export");

    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), Some(&token(&owner)), json!({ "projectId": "999999999" })).await;
    assert_ne!(st, StatusCode::OK, "unknown project is refused, not empty-exported");
}
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/backend-rs && DATABASE_URL=postgres://postgres:postgres@localhost:5432/sedjiwa_tasks cargo test -p transport --test export_flow`
Expected: 2 passed. (Without `DATABASE_URL` they print "skip" and pass — make sure you actually ran them against a database, or you have tested nothing.)

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/transport/tests/export_flow.rs
git commit -m "test(export): cover the CSV guard matrix and row contents"
```

## Task 7: Frontend — generated client and the export feature

**Files:**
- Modify: `apps/frontend/src/lib/gen/` (generated — do not hand-edit)
- Create: `apps/frontend/src/features/exports/types.ts`
- Create: `apps/frontend/src/features/exports/api/hooks.ts`
- Create: `apps/frontend/src/features/exports/components/export-dialog.tsx`
- Create: `apps/frontend/src/features/exports/index.ts`
- Modify: `apps/frontend/src/features/projects/components/project-detail-header.tsx`

- [ ] **Step 1: Generate the client**

Run: `cd apps/frontend && ./node_modules/.bin/buf generate`
Expected: `src/lib/gen/export_pb.ts` appears, exporting `ExportService`.

- [ ] **Step 2: Write `types.ts`**

```typescript
// Flat FE types for the exports feature. Phase 1 only needs the CSV shape;
// job types arrive with the archive path.

export type CsvExport = {
  csv: string;
  fileName: string;
};
```

- [ ] **Step 3: Write `api/hooks.ts`**

```typescript
// Export RPC hooks (connect-query over ExportService). Owner/admin only —
// the server enforces; the UI simply does not offer it to anyone else.

import { useMutation } from "@connectrpc/connect-query";
import { ExportService } from "@/lib/gen/export_pb";

/** Ask the server for a task CSV. The caller triggers the download. */
export function useExportTasksCsv() {
  return useMutation(ExportService.method.exportTasksCsv);
}

/** Hand a generated string to the browser as a file download. */
export function downloadText(fileName: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Write `components/export-dialog.tsx`**

```tsx
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExportTasksCsv, downloadText } from "../api/hooks";

export function ExportDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const csv = useExportTasksCsv();

  function onCsv() {
    csv.mutate(
      { projectId },
      {
        onSuccess: (res) =>
          downloadText(res.fileName, res.csv, "text/csv;charset=utf-8"),
        onError: (err) => toast.error(err.message || "Export failed"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export project</DialogTitle>
          <DialogDescription>
            Take this project&apos;s work out of the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Task list (.csv)</p>
              <p className="text-sm text-text-muted">
                Every task with its module, people, labels and dates. Opens in a
                spreadsheet.
              </p>
            </div>
            <Button size="sm" onClick={onCsv} disabled={csv.isPending}>
              <Download className="mr-1 h-4 w-4" />
              {csv.isPending ? "Preparing…" : "Download"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write the barrel `index.ts`**

```typescript
// Exports feature barrel.

export type { CsvExport } from "./types";
export { useExportTasksCsv, downloadText } from "./api/hooks";
export { ExportDialog } from "./components/export-dialog";
```

- [ ] **Step 6: Add the entry point to the project header**

In `project-detail-header.tsx`:

- add `import { ExportDialog } from "@/features/exports";` with the other feature imports;
- add `const [exportOpen, setExportOpen] = useState(false);` next to `transferOpen`;
- inside the `{canManage && (...)}` block, add this button just before the delete `AlertDialog`:

```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportOpen(true)}
          >
            Export
          </Button>
```

- and render the dialog next to `<TransferOwnershipDialog …/>`:

```tsx
      <ExportDialog
        projectId={project.id}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
```

- [ ] **Step 7: Verify the frontend gates**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint && bun run build`
Expected: all three succeed.

- [ ] **Step 8: Drive it in a browser**

Start the stack (`cd apps/backend-rs && cargo run` in one shell, `cd apps/frontend && bun run dev` in another), log in as a project owner, open a project, click **Export → Download**. Confirm: the file lands, opens in a spreadsheet with one row per task, and a title containing a comma stays in one cell. Then log in as a plain member of that project and confirm the Export button is not there.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/features/exports apps/frontend/src/lib/gen apps/frontend/src/features/projects/components/project-detail-header.tsx
git commit -m "feat(export): download a project's task CSV from the project header"
```

**Phase 1 is shippable here.** Stop and review before starting Phase 2 if you want the CSV in people's hands early.

---

# Phase 2 — The archive

Adds the job table, the worker, the ZIP, and the notification.

## Task 8: Storage grows a read and a write

`rust-s3` version note: the exact method names below are from `s3` 0.35. If a call does not resolve, run `cargo doc -p rust-s3 --open` and look at `Bucket` — do **not** reshape the trait to match a guess.

**Files:**
- Modify: `apps/backend-rs/crates/storage/src/lib.rs`
- Modify: `apps/backend-rs/crates/storage/src/s3_impl.rs`
- Modify: `apps/backend-rs/crates/transport/tests/media_flow.rs`

- [ ] **Step 1: Add the two methods to the trait**

In `lib.rs`, add to `pub trait Storage` (and `use std::path::Path;` at the top):

```rust
    /// Download `key` into a local file, returning bytes written; `None` when the
    /// object is not there. Used to pull media into an export archive.
    async fn get_to_file(&self, key: &str, dest: &Path) -> Result<Option<u64>>;
    /// Upload a local file as `key`, returning bytes uploaded.
    async fn put_file(&self, key: &str, src: &Path, mime: &str) -> Result<u64>;
```

- [ ] **Step 2: Implement them for S3**

In `s3_impl.rs`, inside `impl Storage for S3Storage`, add (plus `use std::path::Path;`):

```rust
    async fn get_to_file(&self, key: &str, dest: &Path) -> Result<Option<u64>> {
        let mut file = tokio::fs::File::create(dest).await?;
        let status = self.bucket.get_object_to_writer(key, &mut file).await;
        match status {
            Ok(200) => {
                use tokio::io::AsyncWriteExt;
                file.flush().await?;
                Ok(Some(tokio::fs::metadata(dest).await?.len()))
            }
            // A missing object is a fact about this archive, not a failure of it.
            Ok(_) | Err(_) => Ok(None),
        }
    }

    async fn put_file(&self, key: &str, src: &Path, mime: &str) -> Result<u64> {
        let mut file = tokio::fs::File::open(src).await?;
        let res = self
            .bucket
            .put_object_stream_with_content_type(&mut file, key, mime)
            .await?;
        Ok(res.uploaded_bytes() as u64)
    }
```

- [ ] **Step 3: Teach the test fake the same two methods**

In `media_flow.rs`, inside `impl Storage for FakeStorage`, add:

```rust
    async fn get_to_file(&self, key: &str, dest: &std::path::Path) -> anyhow::Result<Option<u64>> {
        let Some(size) = self.uploaded.lock().unwrap().get(key).copied() else {
            return Ok(None);
        };
        // Content is irrelevant to these tests; size is what assertions look at.
        tokio::fs::write(dest, vec![b'x'; size as usize]).await?;
        Ok(Some(size))
    }
    async fn put_file(&self, key: &str, src: &std::path::Path, _mime: &str) -> anyhow::Result<u64> {
        let len = tokio::fs::metadata(src).await?.len();
        self.uploaded.lock().unwrap().insert(key.to_string(), len);
        Ok(len)
    }
```

- [ ] **Step 4: Verify**

Run: `cd apps/backend-rs && cargo build && cargo test -p transport --test media_flow`
Expected: builds; media tests still pass (or skip without `DATABASE_URL`).

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/storage apps/backend-rs/crates/transport/tests/media_flow.rs
git commit -m "feat(storage): read an object to a file and upload a file"
```

## Task 9: The job table

**Files:**
- Create: `apps/backend-rs/crates/persistence/src/export.rs`
- Modify: `apps/backend-rs/crates/persistence/src/lib.rs`

- [ ] **Step 1: Write `export.rs`**

```rust
//! Export jobs. Like `search_doc`, this is a raw sqlx table deliberately outside
//! the Arke component model: a job is an operational record, not a domain entity.
//!
//! Timestamps are `text` holding RFC3339 UTC strings, not `timestamptz`: sqlx is
//! built here without the `time`/`chrono` features, every domain component
//! already stores ISO strings, and Z-normalized RFC3339 compares correctly with
//! `<=` — which is all the expiry sweep needs.

use anyhow::Result;
use sqlx::{PgPool, Row};

/// Lifecycle of one archive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportStatus {
    Pending,
    Running,
    Ready,
    Failed,
    Expired,
}

impl ExportStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "running" => Some(Self::Running),
            "ready" => Some(Self::Ready),
            "failed" => Some(Self::Failed),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExportJobRow {
    pub id: i64,
    pub project_id: String,
    pub requested_by: String,
    pub status: String,
    pub storage_key: Option<String>,
    pub size_bytes: Option<i64>,
    pub file_total: i32,
    pub file_done: i32,
    pub attempts: i32,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: Option<String>,
}

const COLS: &str = "id, project_id, requested_by, status, storage_key, size_bytes, \
                    file_total, file_done, attempts, error, created_at, updated_at, expires_at";

fn row(r: &sqlx::postgres::PgRow) -> ExportJobRow {
    ExportJobRow {
        id: r.get("id"),
        project_id: r.get("project_id"),
        requested_by: r.get("requested_by"),
        status: r.get("status"),
        storage_key: r.get("storage_key"),
        size_bytes: r.get("size_bytes"),
        file_total: r.get("file_total"),
        file_done: r.get("file_done"),
        attempts: r.get("attempts"),
        error: r.get("error"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
        expires_at: r.get("expires_at"),
    }
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS export_job (
           id           bigserial PRIMARY KEY,
           project_id   text NOT NULL,
           requested_by text NOT NULL,
           status       text NOT NULL,
           storage_key  text,
           size_bytes   bigint,
           file_total   int  NOT NULL DEFAULT 0,
           file_done    int  NOT NULL DEFAULT 0,
           attempts     int  NOT NULL DEFAULT 0,
           error        text,
           created_at   text NOT NULL,
           updated_at   text NOT NULL,
           expires_at   text
         )",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS export_job_project
         ON export_job (project_id, created_at DESC)",
    )
    .execute(pool)
    .await?;
    // NOTE: as in search.rs, CREATE TABLE IF NOT EXISTS is a no-op on a database
    // that already has the table. Any column added later needs its own
    // `ALTER TABLE export_job ADD COLUMN IF NOT EXISTS …` right here.
    Ok(())
}

impl crate::Store {
    /// Queue an archive, unless one is already pending or running for this
    /// project — in which case return that one. `now` is RFC3339 UTC.
    pub async fn enqueue_export(
        &self,
        project_id: &str,
        requested_by: &str,
        now: &str,
    ) -> Result<ExportJobRow> {
        if let Some(active) = sqlx::query(&format!(
            "SELECT {COLS} FROM export_job
             WHERE project_id = $1 AND status IN ('pending','running')
             ORDER BY id LIMIT 1"
        ))
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return Ok(row(&active));
        }
        let r = sqlx::query(&format!(
            "INSERT INTO export_job (project_id, requested_by, status, created_at, updated_at)
             VALUES ($1, $2, 'pending', $3, $3) RETURNING {COLS}"
        ))
        .bind(project_id)
        .bind(requested_by)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;
        Ok(row(&r))
    }

    /// Claim the oldest pending job. `SKIP LOCKED` keeps this correct if the
    /// deployment ever runs more than one instance.
    pub async fn claim_next_export(&self, now: &str) -> Result<Option<ExportJobRow>> {
        let r = sqlx::query(&format!(
            "UPDATE export_job SET status='running', attempts = attempts + 1, updated_at=$1
             WHERE id = (SELECT id FROM export_job WHERE status='pending'
                         ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
             RETURNING {COLS}"
        ))
        .bind(now)
        .fetch_optional(&self.pool)
        .await?;
        Ok(r.as_ref().map(row))
    }

    pub async fn set_export_total(&self, id: i64, total: i32, now: &str) -> Result<()> {
        sqlx::query("UPDATE export_job SET file_total=$2, updated_at=$3 WHERE id=$1")
            .bind(id).bind(total).bind(now)
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn bump_export_progress(&self, id: i64, done: i32, now: &str) -> Result<()> {
        sqlx::query("UPDATE export_job SET file_done=$2, updated_at=$3 WHERE id=$1")
            .bind(id).bind(done).bind(now)
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn mark_export_ready(
        &self,
        id: i64,
        storage_key: &str,
        size_bytes: i64,
        now: &str,
        expires_at: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE export_job SET status='ready', storage_key=$2, size_bytes=$3,
                                   updated_at=$4, expires_at=$5, error=NULL
             WHERE id=$1",
        )
        .bind(id).bind(storage_key).bind(size_bytes).bind(now).bind(expires_at)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Failed for now. Under `max_attempts` the job goes back to `pending` so the
    /// next tick retries it; at or above, it stays failed with its reason.
    pub async fn mark_export_failed(
        &self,
        id: i64,
        error: &str,
        now: &str,
        max_attempts: i32,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE export_job
             SET status = CASE WHEN attempts >= $4 THEN 'failed' ELSE 'pending' END,
                 error = $2, updated_at = $3
             WHERE id = $1",
        )
        .bind(id).bind(error).bind(now).bind(max_attempts)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// A process died mid-assembly; whatever it was doing is not happening.
    pub async fn requeue_running_exports(&self, now: &str) -> Result<u64> {
        let r = sqlx::query("UPDATE export_job SET status='pending', updated_at=$1 WHERE status='running'")
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    /// Ready archives past their expiry, oldest first.
    pub async fn expired_exports(&self, now: &str) -> Result<Vec<ExportJobRow>> {
        let rows = sqlx::query(&format!(
            "SELECT {COLS} FROM export_job
             WHERE status='ready' AND expires_at IS NOT NULL AND expires_at <= $1
             ORDER BY id"
        ))
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(row).collect())
    }

    pub async fn mark_export_expired(&self, id: i64, now: &str) -> Result<()> {
        sqlx::query("UPDATE export_job SET status='expired', storage_key=NULL, updated_at=$2 WHERE id=$1")
            .bind(id).bind(now)
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get_export(&self, id: i64) -> Result<Option<ExportJobRow>> {
        let r = sqlx::query(&format!("SELECT {COLS} FROM export_job WHERE id=$1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(r.as_ref().map(row))
    }

    /// A project's jobs, newest first, capped — the dialog shows a short history.
    pub async fn exports_for_project(&self, project_id: &str, limit: i64) -> Result<Vec<ExportJobRow>> {
        let rows = sqlx::query(&format!(
            "SELECT {COLS} FROM export_job WHERE project_id=$1 ORDER BY id DESC LIMIT $2"
        ))
        .bind(project_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(row).collect())
    }

    /// Every job of a project, for the delete cleanup. Returns the rows so the
    /// caller can delete their archives from object storage first.
    pub async fn take_exports_for_project(&self, project_id: &str) -> Result<Vec<ExportJobRow>> {
        let rows = sqlx::query(&format!(
            "DELETE FROM export_job WHERE project_id=$1 RETURNING {COLS}"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(row).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Store;

    async fn store() -> Option<Store> {
        let url = std::env::var("ARKE_TEST_DATABASE_URL").ok()?;
        Some(Store::connect(&url, |_| {}).await.unwrap())
    }

    #[tokio::test]
    async fn enqueue_is_deduped_then_claimed_once() {
        let Some(s) = store().await else {
            eprintln!("skip: ARKE_TEST_DATABASE_URL not set");
            return;
        };
        let project = format!("p{}", std::process::id());
        let a = s.enqueue_export(&project, "u1", "2026-08-20T00:00:00Z").await.unwrap();
        let b = s.enqueue_export(&project, "u1", "2026-08-20T00:00:01Z").await.unwrap();
        assert_eq!(a.id, b.id, "a second request joins the running job");

        let claimed = s.claim_next_export("2026-08-20T00:00:02Z").await.unwrap().unwrap();
        assert_eq!(claimed.id, a.id);
        assert_eq!(claimed.status, "running");
        assert_eq!(claimed.attempts, 1);

        // Restart recovery puts it back.
        s.requeue_running_exports("2026-08-20T00:00:03Z").await.unwrap();
        assert_eq!(s.get_export(a.id).await.unwrap().unwrap().status, "pending");

        // Third failure sticks.
        s.claim_next_export("2026-08-20T00:00:04Z").await.unwrap();
        s.mark_export_failed(a.id, "boom", "2026-08-20T00:00:05Z", 3).await.unwrap();
        assert_eq!(s.get_export(a.id).await.unwrap().unwrap().status, "pending", "retry below the cap");
        s.claim_next_export("2026-08-20T00:00:06Z").await.unwrap();
        s.mark_export_failed(a.id, "boom", "2026-08-20T00:00:07Z", 3).await.unwrap();
        assert_eq!(s.get_export(a.id).await.unwrap().unwrap().status, "failed", "cap reached");

        s.take_exports_for_project(&project).await.unwrap();
    }

    #[tokio::test]
    async fn expiry_sweep_selects_only_ready_and_past_due() {
        let Some(s) = store().await else {
            eprintln!("skip: ARKE_TEST_DATABASE_URL not set");
            return;
        };
        let project = format!("e{}", std::process::id());
        let j = s.enqueue_export(&project, "u1", "2026-08-20T00:00:00Z").await.unwrap();
        s.claim_next_export("2026-08-20T00:00:01Z").await.unwrap();
        s.mark_export_ready(j.id, "exports/x.zip", 10, "2026-08-20T00:00:02Z", "2026-08-27T00:00:00Z")
            .await.unwrap();

        assert!(s.expired_exports("2026-08-21T00:00:00Z").await.unwrap().iter().all(|r| r.id != j.id));
        let due = s.expired_exports("2026-08-28T00:00:00Z").await.unwrap();
        assert!(due.iter().any(|r| r.id == j.id), "past expiry is swept");

        s.mark_export_expired(j.id, "2026-08-28T00:00:01Z").await.unwrap();
        let after = s.get_export(j.id).await.unwrap().unwrap();
        assert_eq!(after.status, "expired");
        assert!(after.storage_key.is_none(), "no key once the object is gone");

        s.take_exports_for_project(&project).await.unwrap();
    }
}
```

- [ ] **Step 2: Register the module and its migration**

In `crates/persistence/src/lib.rs`:
- add `pub mod export;` next to `pub mod search;`
- add `pub use export::{ExportJobRow, ExportStatus};` next to the search re-export
- inside `Store::connect`, after `search::migrate(&pool).await?;`, add `export::migrate(&pool).await?;`

- [ ] **Step 3: Run the tests**

Run: `cd apps/backend-rs && ARKE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sedjiwa_tasks cargo test -p persistence export`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/persistence
git commit -m "feat(export): add the export_job table and its queries"
```

## Task 10: `export.json` (TDD)

**Files:**
- Create: `apps/backend-rs/crates/transport/src/export/json.rs`
- Modify: `apps/backend-rs/crates/transport/Cargo.toml`

- [ ] **Step 1: Promote `serde_json` to a real dependency**

In `crates/transport/Cargo.toml`, move `serde_json = { workspace = true }` from `[dev-dependencies]` into `[dependencies]` (leave the dev entry out; one listing is enough).

- [ ] **Step 2: Write the failing test**

Create `json.rs` with the test module first:

```rust
//! ProjectSnapshot → export.json. Pure: takes the media manifest the archive
//! actually wrote, so the document can never claim a file the ZIP lacks.

use serde::Serialize;
use serde_json::json;

use super::model::{MediaOut, ProjectSnapshot};

/// One entry the archive really contains.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ArchivedMedia {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub uploaded_by: String,
    pub created_at: String,
    pub task_ids: Vec<String>,
    /// Path inside the ZIP.
    pub path: String,
}

/// One entry it does not, and why.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct SkippedMedia {
    pub id: String,
    pub file_name: String,
    pub reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::model::{ProjectOut, UserOut};

    fn snapshot() -> ProjectSnapshot {
        ProjectSnapshot {
            project: ProjectOut { id: "5".into(), name: "Toko".into(), ..Default::default() },
            users: vec![UserOut { id: "1".into(), name: "Rina".into() }],
            ..Default::default()
        }
    }

    #[test]
    fn carries_the_schema_version_and_who_exported_it() {
        let out = export_json(&snapshot(), "2026-08-20T09:00:00Z", "1", "Rina", &[], &[]);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["schema_version"], 1);
        assert_eq!(v["exported_at"], "2026-08-20T09:00:00Z");
        assert_eq!(v["exported_by"]["id"], "1");
        assert_eq!(v["exported_by"]["name"], "Rina");
        assert_eq!(v["project"]["name"], "Toko");
    }

    #[test]
    fn users_carry_id_and_name_only() {
        let out = export_json(&snapshot(), "2026-08-20T09:00:00Z", "1", "Rina", &[], &[]);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let user = &v["users"][0];
        assert_eq!(user["id"], "1");
        assert_eq!(user["name"], "Rina");
        assert_eq!(user.as_object().unwrap().len(), 2, "no phone, no email, ever: {user}");
    }

    #[test]
    fn manifest_lists_what_was_written_and_what_was_skipped() {
        let archived = [ArchivedMedia {
            id: "20".into(),
            file_name: "denah.png".into(),
            mime_type: "image/png".into(),
            size: 12,
            uploaded_by: "1".into(),
            created_at: "2026-08-01T00:00:00Z".into(),
            task_ids: vec!["30".into()],
            path: "media/20-denah.png".into(),
        }];
        let skipped = [SkippedMedia {
            id: "21".into(),
            file_name: "hilang.pdf".into(),
            reason: "missing".into(),
        }];
        let out = export_json(&snapshot(), "2026-08-20T09:00:00Z", "1", "Rina", &archived, &skipped);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["media"][0]["path"], "media/20-denah.png");
        assert!(v["media"][0].get("storage_key").is_none(), "internal key must not leak");
        assert_eq!(v["media_skipped"][0]["reason"], "missing");
    }

    #[test]
    fn zip_path_is_derived_from_id_and_name() {
        let m = MediaOut {
            id: "20".into(),
            file_name: "foto liburan/2026.png".into(),
            mime_type: "image/png".into(),
            size: 1,
            uploaded_by: "1".into(),
            created_at: "x".into(),
            task_ids: vec![],
            storage_key: "k".into(),
        };
        assert_eq!(media_path(&m), "media/20-foto-liburan-2026.png");
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/backend-rs && cargo test -p transport export::json`
Expected: FAIL — `cannot find function export_json`, `cannot find function media_path`.

- [ ] **Step 4: Write the implementation**

Insert above the test module:

```rust
/// Bump when the document's shape changes in a way a reader must know about
/// (STD-0007: a published contract carries its version).
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// Where a media file lives inside the archive. Sanitized so an archive can be
/// unpacked safely on any filesystem — a file name is user input.
pub(crate) fn media_path(m: &MediaOut) -> String {
    let stem = super::file_slug(m.file_name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&m.file_name));
    let ext = m
        .file_name
        .rsplit_once('.')
        .map(|(_, e)| super::file_slug(e))
        .filter(|e| !e.is_empty());
    match ext {
        Some(e) => format!("media/{}-{}.{}", m.id, stem, e),
        None => format!("media/{}-{}", m.id, stem),
    }
}

/// The archive's manifest. `archived` and `skipped` come from the copy loop, so
/// the document describes the ZIP as built rather than as planned.
pub(crate) fn export_json(
    s: &ProjectSnapshot,
    exported_at: &str,
    exported_by_id: &str,
    exported_by_name: &str,
    archived: &[ArchivedMedia],
    skipped: &[SkippedMedia],
) -> String {
    let doc = json!({
        "schema_version": SCHEMA_VERSION,
        "exported_at": exported_at,
        "exported_by": { "id": exported_by_id, "name": exported_by_name },
        "project": s.project,
        "users": s.users,
        "modules": s.modules,
        "tasks": s.tasks,
        "labels": s.labels,
        "comments": s.comments,
        "pages": s.pages,
        "activity": s.activity,
        "media": archived,
        "media_skipped": skipped,
    });
    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".to_string())
}
```

Add `mod json;` to `export/mod.rs`.

- [ ] **Step 5: Run the tests**

Run: `cd apps/backend-rs && cargo test -p transport export::json`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/transport
git commit -m "feat(export): serialize the versioned export.json manifest"
```

## Task 11: ZIP assembly

**Files:**
- Modify: `apps/backend-rs/Cargo.toml` (workspace deps)
- Modify: `apps/backend-rs/crates/transport/Cargo.toml`
- Create: `apps/backend-rs/crates/transport/src/export/archive.rs`

- [ ] **Step 1: Add the `zip` dependency**

In the workspace `[workspace.dependencies]`: `zip = { version = "2", default-features = false, features = ["deflate"] }`
In `crates/transport/Cargo.toml` `[dependencies]`: `zip = { workspace = true }`

- [ ] **Step 2: Write `archive.rs`**

```rust
//! Building one archive: temp file, media copies, manifest, upload.
//!
//! The manifest is written LAST on purpose. A media object that vanished from S3
//! mid-run then neither fails the export nor leaves a lying entry — it lands in
//! `media_skipped` instead.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use persistence::Store;
use storage::Storage;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::CompressionMethod;

use super::csv::tasks_csv;
use super::gather::gather;
use super::json::{export_json, media_path, ArchivedMedia, SkippedMedia};

/// Deletes its path on drop, including when assembly fails part-way.
struct TempPath(PathBuf);
impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub(crate) struct BuiltArchive {
    pub storage_key: String,
    pub size_bytes: i64,
}

/// Assemble and upload the archive for `job_id`, updating the job's file counter
/// as it goes. `now` is RFC3339 UTC.
pub(crate) async fn build_and_upload(
    store: &Store,
    storage: &dyn Storage,
    job_id: i64,
    project_id: &str,
    requested_by: &str,
    now: &str,
) -> Result<BuiltArchive> {
    // 1. All of the JSON data first, so the document is internally consistent.
    let snapshot = gather(store, project_id).await?;
    let exported_by_name = snapshot
        .users
        .iter()
        .find(|u| u.id == requested_by)
        .map(|u| u.name.clone())
        .unwrap_or_default();

    let dir = std::env::temp_dir();
    let zip_path = TempPath(dir.join(format!("export-{job_id}.zip")));
    let scratch = TempPath(dir.join(format!("export-{job_id}.part")));

    let mut writer = ZipWriter::new(File::create(&zip_path.0).context("create archive")?);
    // Media is already compressed; recompressing burns CPU for nothing.
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // 2. Media bytes, one at a time.
    let mut archived: Vec<ArchivedMedia> = Vec::new();
    let mut skipped: Vec<SkippedMedia> = Vec::new();
    for (i, m) in snapshot.media.iter().enumerate() {
        let path_in_zip = media_path(m);
        match storage.get_to_file(&m.storage_key, &scratch.0).await {
            Ok(Some(_)) => {
                let src = scratch.0.clone();
                let name = path_in_zip.clone();
                // zip is sync; hand the writer to a blocking thread and take it back.
                let (w, res) = tokio::task::spawn_blocking(move || {
                    let mut w = writer;
                    let r = (|| -> Result<()> {
                        w.start_file(&name, stored)?;
                        let mut f = File::open(&src)?;
                        std::io::copy(&mut f, &mut w)?;
                        Ok(())
                    })();
                    (w, r)
                })
                .await?;
                writer = w;
                match res {
                    Ok(()) => archived.push(ArchivedMedia {
                        id: m.id.clone(),
                        file_name: m.file_name.clone(),
                        mime_type: m.mime_type.clone(),
                        size: m.size,
                        uploaded_by: m.uploaded_by.clone(),
                        created_at: m.created_at.clone(),
                        task_ids: m.task_ids.clone(),
                        path: path_in_zip,
                    }),
                    Err(e) => skipped.push(SkippedMedia {
                        id: m.id.clone(),
                        file_name: m.file_name.clone(),
                        reason: format!("zip failed: {e}"),
                    }),
                }
            }
            Ok(None) => skipped.push(SkippedMedia {
                id: m.id.clone(),
                file_name: m.file_name.clone(),
                reason: "missing".into(),
            }),
            Err(e) => skipped.push(SkippedMedia {
                id: m.id.clone(),
                file_name: m.file_name.clone(),
                reason: format!("unreadable: {e}"),
            }),
        }
        // Progress is advisory: a failed update must never fail the export.
        let _ = store
            .bump_export_progress(job_id, i as i32 + 1, &super::now_iso())
            .await;
    }

    // 3. Manifest and CSV last — they describe what actually went in.
    let manifest = export_json(&snapshot, now, requested_by, &exported_by_name, &archived, &skipped);
    let csv = tasks_csv(&snapshot);
    let mut writer = tokio::task::spawn_blocking(move || -> Result<ZipWriter<File>> {
        let mut w = writer;
        w.start_file("export.json", deflated)?;
        w.write_all(manifest.as_bytes())?;
        w.start_file("tasks.csv", deflated)?;
        w.write_all(csv.as_bytes())?;
        Ok(w)
    })
    .await??;
    tokio::task::spawn_blocking(move || writer.finish().map(|_| ())).await??;

    // 4. Upload, then let both temp files go.
    let storage_key = format!("exports/{project_id}/{job_id}.zip");
    let size = storage
        .put_file(&storage_key, &zip_path.0, "application/zip")
        .await
        .context("upload archive")?;

    Ok(BuiltArchive {
        storage_key,
        size_bytes: size as i64,
    })
}

/// How many media files this project would contribute — the denominator the UI
/// shows before the copy loop starts.
pub(crate) async fn media_count(store: &Store, project_id: &str) -> Result<i32> {
    Ok(gather(store, project_id).await?.media.len() as i32)
}
```

Add `mod archive;` to `export/mod.rs`.

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/backend-rs && cargo build -p transport && cargo clippy -p transport --all-targets -- -D warnings`
Expected: success. If `SimpleFileOptions` does not resolve, you are on `zip` 1.x — check the version you actually pulled.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/Cargo.toml apps/backend-rs/crates/transport
git commit -m "feat(export): assemble a project archive into a ZIP"
```

## Task 12: The archive RPCs

**Files:**
- Modify: `apps/backend-rs/proto/export.proto`
- Create: `apps/backend-rs/crates/transport/src/export/record.rs`
- Modify: `apps/backend-rs/crates/transport/src/export/export_service.rs`

- [ ] **Step 1: Extend the proto**

Add to `service ExportService`:

```proto
  // Queue a full archive. Returns the job — existing one if this project already
  // has one pending or running.
  rpc StartExport(StartExportRequest) returns (ExportJob);
  rpc ListExports(ListExportsRequest) returns (ListExportsResponse);
  rpc GetExportDownloadUrl(GetExportDownloadUrlRequest) returns (GetExportDownloadUrlResponse);
```

and below the CSV messages:

```proto
enum ExportStatus {
  EXPORT_STATUS_UNSPECIFIED = 0;
  PENDING = 1;
  RUNNING = 2;
  READY = 3;
  FAILED = 4;
  EXPIRED = 5;
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

message StartExportRequest { string project_id = 1; }
message ListExportsRequest { string project_id = 1; }
message ListExportsResponse { repeated ExportJob jobs = 1; }
message GetExportDownloadUrlRequest { string id = 1; }
message GetExportDownloadUrlResponse {
  string url = 1;
  string file_name = 2;
}
```

- [ ] **Step 2: Write `record.rs`**

```rust
//! Job rows → proto.

use persistence::{ExportJobRow, ExportStatus};

use crate::sedjiwa::tasks::export::v1 as pb;

pub(crate) fn to_proto(j: &ExportJobRow) -> pb::ExportJob {
    let status = match ExportStatus::parse(&j.status) {
        Some(ExportStatus::Pending) => pb::ExportStatus::Pending,
        Some(ExportStatus::Running) => pb::ExportStatus::Running,
        Some(ExportStatus::Ready) => pb::ExportStatus::Ready,
        Some(ExportStatus::Failed) => pb::ExportStatus::Failed,
        Some(ExportStatus::Expired) => pb::ExportStatus::Expired,
        None => pb::ExportStatus::Unspecified,
    };
    pb::ExportJob {
        id: j.id.to_string(),
        project_id: j.project_id.clone(),
        requested_by: j.requested_by.clone(),
        status: status as i32,
        size_bytes: j.size_bytes,
        file_total: j.file_total,
        file_done: j.file_done,
        error: j.error.clone(),
        created_at: j.created_at.clone(),
        updated_at: j.updated_at.clone(),
        expires_at: j.expires_at.clone(),
    }
}
```

- [ ] **Step 3: Add the three handlers**

In `export_service.rs`, add these imports and handlers, and extend `export_router`:

```rust
use std::sync::Arc;
use tokio::sync::Notify;
use storage::Storage;

use super::record::to_proto;
use super::{now_iso, DOWNLOAD_TTL_SECS};

type StorageExt = Extension<Arc<dyn Storage>>;
type WakeExt = Extension<Arc<Notify>>;

async fn start_export(
    Extension(store): StoreExt,
    Extension(wake): WakeExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::StartExportRequest>,
) -> Result<ConnectResponse<pb::ExportJob>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let project = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &project)?;

    let job = store
        .enqueue_export(&r.project_id, &auth.id, &now_iso())
        .await
        .map_err(internal)?;
    // Start now rather than at the next tick.
    wake.notify_one();
    Ok(ConnectResponse::new(to_proto(&job)))
}

async fn list_exports(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListExportsRequest>,
) -> Result<ConnectResponse<pb::ListExportsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let project = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &project)?;

    let jobs = store
        .exports_for_project(&r.project_id, 10)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListExportsResponse {
        jobs: jobs.iter().map(to_proto).collect(),
    }))
}

/// Re-checks ownership at redemption, not only at request time: ownership can
/// move between the two, and a former owner must not walk away with the archive.
async fn get_export_download_url(
    Extension(store): StoreExt,
    Extension(storage): StorageExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetExportDownloadUrlRequest>,
) -> Result<ConnectResponse<pb::GetExportDownloadUrlResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let job_id = r
        .id
        .parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("export not found"))?;
    let job = store
        .get_export(job_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("export not found"))?;

    let pid = parse_pid(&job.project_id)?;
    let project = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &project)?;

    let key = job
        .storage_key
        .as_deref()
        .ok_or_else(|| ConnectError::new_failed_precondition("archive is not available"))?;
    let url = storage
        .presign_get(key, DOWNLOAD_TTL_SECS)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::GetExportDownloadUrlResponse {
        url,
        file_name: format!("{}-export.zip", file_slug(&project.name)),
    }))
}
```

Replace `export_router` with:

```rust
/// ExportService router. Storage is needed to presign the archive download, and
/// the `Notify` handle lets StartExport wake the worker immediately.
pub fn export_router(
    store: Arc<Store>,
    storage: Arc<dyn Storage>,
    wake: Arc<Notify>,
) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ExportServiceBuilder::<()>::new()
        .export_tasks_csv::<_, (StoreExt, A, ConnectRequest<pb::ExportTasksCsvRequest>)>(export_tasks_csv)
        .start_export::<_, (StoreExt, WakeExt, A, ConnectRequest<pb::StartExportRequest>)>(start_export)
        .list_exports::<_, (StoreExt, A, ConnectRequest<pb::ListExportsRequest>)>(list_exports)
        .get_export_download_url::<_, (StoreExt, StorageExt, A, ConnectRequest<pb::GetExportDownloadUrlRequest>)>(
            get_export_download_url,
        )
        .build()
        .layer(Extension(store))
        .layer(Extension(storage))
        .layer(Extension(wake))
}
```

- [ ] **Step 4: Add the shared constants to `mod.rs`**

```rust
/// Presigned archive downloads live an hour and can be reissued while the job is
/// ready — long enough to click, short enough that a pasted URL goes stale.
pub(crate) const DOWNLOAD_TTL_SECS: u32 = 3600;
/// Archives are swept a week after they are built.
pub(crate) const RETENTION_DAYS: i64 = 7;
/// A job that has exploded this many times stops being retried.
pub(crate) const MAX_ATTEMPTS: i32 = 3;

pub(crate) fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

pub(crate) fn expires_iso(days: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    (time::OffsetDateTime::now_utc() + time::Duration::days(days))
        .format(&Rfc3339)
        .unwrap_or_default()
}
```

- [ ] **Step 5: Update the router call site**

`build_router` must **receive** the wake handle rather than create one, because Task 13 spawns the worker with the same handle and a second `Notify` would mean `StartExport` wakes nobody. In `crates/app/src/router.rs`:

```rust
pub fn build_router(
    cfg: &Config,
    store: Arc<Store>,
    media_storage: Arc<dyn Storage>,
    notifier: Arc<Notifier>,
    export_wake: Arc<tokio::sync::Notify>,
) -> Router {
```

and add the merge after the search router:

```rust
        .merge(transport::export_router(store.clone(), media_storage.clone(), export_wake))
```

`main.rs` does not compile until Task 13 Step 4 passes the fifth argument. That is expected; finish Task 13 before running the app.

- [ ] **Step 6: Update the flow test's setup for the new signature**

`export_router` now takes three arguments, so `crates/transport/tests/export_flow.rs` needs a fake Storage and a wake handle. Copy the `FakeStorage` struct and its `impl Storage` from `tests/media_flow.rs` verbatim (including the two methods added in Task 8), then replace `setup`:

```rust
async fn setup() -> Option<(Router, Arc<Store>, Arc<FakeStorage>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let fake = Arc::new(FakeStorage::default());
    let storage: Arc<dyn Storage> = fake.clone();
    let wake = Arc::new(tokio::sync::Notify::new());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::export_router(store.clone(), storage, wake))
        .layer(from_fn(auth_mw));
    Some((router, store, fake))
}
```

Update the two Phase 1 tests to destructure three values (`let Some((router, store, _fake)) = setup().await`). No worker is spawned in tests: nothing claims the queued jobs, which is exactly what keeps them deterministic.

- [ ] **Step 7: Verify**

Run: `cd apps/backend-rs && cargo build -p transport && cargo clippy -p transport --all-targets -- -D warnings`
Expected: success. (`cargo build` for the whole workspace fails until Task 13 Step 4 — `main.rs` still calls `build_router` with four arguments.)

- [ ] **Step 8: Commit**

```bash
git add apps/backend-rs/proto/export.proto apps/backend-rs/crates/transport apps/backend-rs/crates/app
git commit -m "feat(export): queue archives, list them, and presign the download"
```

## Task 13: The worker

**Files:**
- Modify: `apps/backend-rs/proto/notifications.proto`
- Modify: `apps/backend-rs/crates/domain/src/notification.rs`
- Modify: `apps/backend-rs/crates/transport/src/notifications/mod.rs`
- Create: `apps/backend-rs/crates/transport/src/export/worker.rs`
- Modify: `apps/backend-rs/crates/app/src/main.rs`

- [ ] **Step 1: Add the two notification types**

In `proto/notifications.proto`, extend the enum:

```proto
  EXPORT_READY = 6;
  EXPORT_FAILED = 7;
```

In `domain/src/notification.rs`, add `ExportReady` and `ExportFailed` variants to `NotificationType`, with `as_str` values `"export_ready"` / `"export_failed"`, matching `parse` arms, and `to_proto` values `6` / `7`. Add both to the round-trip test's array.

- [ ] **Step 2: Make `emit` reachable from the export module**

In `crates/transport/src/notifications/mod.rs`, change `pub(crate) use notifier::{emit, NotifRefs};` — it is already `pub(crate)`, so nothing changes. Confirm by reading the file; if `emit` is private, widen it to `pub(crate)`.

- [ ] **Step 3: Write `worker.rs`**

```rust
//! The export worker: claim one job, build it, announce it. Also sweeps expired
//! archives. Spawned once at boot; single instance, one job at a time — export is
//! heavy I/O and parallelism here would only starve the API path.

use std::sync::Arc;
use std::time::Duration;

use domain::notification::NotificationType;
use persistence::Store;
use storage::Storage;
use tokio::sync::Notify;

use super::archive::{build_and_upload, media_count};
use super::{expires_iso, now_iso, MAX_ATTEMPTS, RETENTION_DAYS};
use crate::notifications::{emit, NotifRefs, Notifier};

/// Safety net for jobs left behind by a restart, and the cadence of the sweep.
const TICK: Duration = Duration::from_secs(60);

pub fn spawn_export_worker(
    store: Arc<Store>,
    storage: Arc<dyn Storage>,
    notifier: Arc<Notifier>,
    wake: Arc<Notify>,
) {
    tokio::spawn(async move {
        // Whatever was "running" died with the previous process.
        match store.requeue_running_exports(&now_iso()).await {
            Ok(n) if n > 0 => tracing::info!(count = n, "requeued export jobs after restart"),
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "failed to requeue running exports"),
        }
        loop {
            // Drain everything pending before sleeping again.
            while run_one(&store, storage.as_ref(), &notifier).await {}
            sweep(&store, storage.as_ref()).await;
            tokio::select! {
                _ = wake.notified() => {}
                _ = tokio::time::sleep(TICK) => {}
            }
        }
    });
}

/// Returns true if a job was claimed (so the caller should look for another).
async fn run_one(store: &Store, storage: &dyn Storage, notifier: &Notifier) -> bool {
    let job = match store.claim_next_export(&now_iso()).await {
        Ok(Some(j)) => j,
        Ok(None) => return false,
        Err(e) => {
            tracing::warn!(error = %e, "claiming an export job failed");
            return false;
        }
    };

    if let Ok(total) = media_count(store, &job.project_id).await {
        let _ = store.set_export_total(job.id, total, &now_iso()).await;
    }

    let built = build_and_upload(
        store,
        storage,
        job.id,
        &job.project_id,
        &job.requested_by,
        &now_iso(),
    )
    .await;

    match built {
        Ok(a) => {
            let _ = store
                .mark_export_ready(
                    job.id,
                    &a.storage_key,
                    a.size_bytes,
                    &now_iso(),
                    &expires_iso(RETENTION_DAYS),
                )
                .await;
            announce(
                store,
                notifier,
                &job.requested_by,
                &job.project_id,
                NotificationType::ExportReady,
                "Your project archive is ready to download".to_string(),
            )
            .await;
        }
        Err(e) => {
            tracing::warn!(job = job.id, error = %e, "export failed");
            let _ = store
                .mark_export_failed(job.id, &e.to_string(), &now_iso(), MAX_ATTEMPTS)
                .await;
            // Only tell them once it has actually given up.
            if job.attempts >= MAX_ATTEMPTS {
                announce(
                    store,
                    notifier,
                    &job.requested_by,
                    &job.project_id,
                    NotificationType::ExportFailed,
                    "Your project archive could not be built".to_string(),
                )
                .await;
            }
        }
    }
    true
}

/// `emit` drops a notification when recipient == actor, and an export is the one
/// case where they are the same person. Emitting with an empty actor makes it a
/// system event, which is what it is.
async fn announce(
    store: &Store,
    notifier: &Notifier,
    recipient: &str,
    project_id: &str,
    kind: NotificationType,
    message: String,
) {
    emit(store, notifier, recipient, kind, "", message, NotifRefs::project(project_id)).await;
}

/// Delete archives past their expiry; keep the row as the trace that an export
/// happened, by whom and when.
async fn sweep(store: &Store, storage: &dyn Storage) {
    let due = match store.expired_exports(&now_iso()).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(error = %e, "expiry sweep query failed");
            return;
        }
    };
    for job in due {
        if let Some(key) = &job.storage_key {
            let _ = storage.delete(key).await;
        }
        let _ = store.mark_export_expired(job.id, &now_iso()).await;
    }
}
```

Add `mod worker;` and `pub use worker::spawn_export_worker;` to `export/mod.rs`, and re-export from `transport/src/lib.rs`: `pub use export::{export_router, spawn_export_worker};`.

`Notifier` must be reachable: in `transport/src/notifications/mod.rs` it is already `pub use notifier::Notifier;`, so `crate::notifications::Notifier` resolves.

- [ ] **Step 4: Spawn it at boot**

In `crates/app/src/main.rs`, after the notifier line:

```rust
    let export_wake = Arc::new(tokio::sync::Notify::new());
    transport::spawn_export_worker(
        store.clone(),
        media_storage.clone(),
        notifier.clone(),
        export_wake.clone(),
    );
    let app = router::build_router(&cfg, store, media_storage, notifier, export_wake);
```

- [ ] **Step 5: Verify**

Run: `cd apps/backend-rs && cargo build && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: builds clean; the notification round-trip test covers the two new kinds.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs
git commit -m "feat(export): build queued archives in a background worker"
```

## Task 14: Clean up when a project is deleted

The obvious implementation — delete the rows and the S3 objects inside `delete_project` — needs Storage in `project_service`, which changes `project_router`'s signature and drags in every flow test that merges it. Instead, deletion **expires** the jobs and lets the sweep that already exists remove the objects on its next tick. The archive becomes unreachable through the app immediately (`GetExportDownloadUrl` loads the project first, and the project is gone), and the object is deleted within the minute.

**Files:**
- Modify: `apps/backend-rs/crates/persistence/src/export.rs`
- Modify: `apps/backend-rs/crates/transport/src/projects/project_service.rs`
- Modify: `apps/backend-rs/crates/transport/tests/export_flow.rs`

- [ ] **Step 1: Write the failing test**

Add to `export_flow.rs`:

```rust
#[tokio::test]
async fn deleting_a_project_hands_its_archives_to_the_sweep() {
    let Some((router, store, _fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let to = token(&owner);
    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Buang {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();

    let ready_id: i64 = ok(&router, &format!("{EXPORT}/StartExport"), &to, json!({ "projectId": project })).await["id"]
        .as_str().unwrap().parse().unwrap();
    let key = format!("exports/{project}/{ready_id}.zip");
    // Pretend the worker finished, with an expiry a week out.
    store.mark_export_ready(ready_id, &key, 42, "2026-08-20T00:00:00Z", "2999-01-01T00:00:00Z").await.unwrap();

    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": project })).await;

    // The archive is now due for collection rather than sitting for a week.
    let due = store.expired_exports("2026-08-20T00:00:01Z").await.unwrap();
    assert!(due.iter().any(|j| j.id == ready_id), "ready archive is handed to the sweep");

    // And it is unreachable through the app right now, project being gone.
    let (st, _) = call(&router, &format!("{EXPORT}/GetExportDownloadUrl"), Some(&to), json!({ "id": ready_id.to_string() })).await;
    assert_ne!(st, StatusCode::OK, "no download for a deleted project's archive");

    store.take_exports_for_project(&project).await.unwrap();
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/backend-rs && DATABASE_URL=postgres://postgres:postgres@localhost:5432/sedjiwa_tasks cargo test -p transport --test export_flow deleting_a_project`
Expected: FAIL — the archive is not due until 2999.

- [ ] **Step 3: Add the query**

In `crates/persistence/src/export.rs`, inside `impl crate::Store`:

```rust
    /// The project is going away: bring every ready archive's expiry forward so
    /// the sweep collects it, and drop the jobs that have no object behind them.
    pub async fn expire_exports_for_project(&self, project_id: &str, now: &str) -> Result<()> {
        sqlx::query(
            "UPDATE export_job SET expires_at=$2, updated_at=$2
             WHERE project_id=$1 AND status='ready'",
        )
        .bind(project_id)
        .bind(now)
        .execute(&self.pool)
        .await?;
        sqlx::query("DELETE FROM export_job WHERE project_id=$1 AND status <> 'ready'")
            .bind(project_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
```

- [ ] **Step 4: Call it from `delete_project`**

In `project_service.rs`, right after `deindex_project(&store, &pid.to_string()).await;`:

```rust
    // An archive is a copy of a project that was asked to disappear. Expiring it
    // here hands the object to the worker's sweep; the download is already
    // unreachable, since it loads the project first.
    let _ = store
        .expire_exports_for_project(&pid.to_string(), &crate::export::now_iso())
        .await;
```

`now_iso` must be reachable: in `crates/transport/src/export/mod.rs`, it is already `pub(crate)`, and `mod export;` is declared in `lib.rs`, so `crate::export::now_iso()` resolves.

- [ ] **Step 5: Run the tests**

Run: `cd apps/backend-rs && DATABASE_URL=… cargo test -p transport`
Expected: every flow test passes, including the new one. No other test's `setup()` changed, because `project_router` did not.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/persistence apps/backend-rs/crates/transport
git commit -m "feat(export): expire a deleted project's archives for the sweep"
```

## Task 15: Flow test — the archive path end to end

**Files:**
- Modify: `apps/backend-rs/crates/transport/tests/export_flow.rs`

- [ ] **Step 1: Write the tests**

```rust
#[tokio::test]
async fn start_export_is_owner_gated_and_deduped() {
    let Some((router, store, _fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let member = mk_user(&store, "Budi").await;
    let (to, tm) = (token(&owner), token(&member));
    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Arsip {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": project, "userId": member })).await;

    let (st, _) = call(&router, &format!("{EXPORT}/StartExport"), Some(&tm), json!({ "projectId": project })).await;
    assert_ne!(st, StatusCode::OK, "member must not queue an archive");

    let a = ok(&router, &format!("{EXPORT}/StartExport"), &to, json!({ "projectId": project })).await;
    let b = ok(&router, &format!("{EXPORT}/StartExport"), &to, json!({ "projectId": project })).await;
    assert_eq!(a["id"], b["id"], "a second request joins the queued job");

    let list = ok(&router, &format!("{EXPORT}/ListExports"), &to, json!({ "projectId": project })).await;
    assert_eq!(list["jobs"].as_array().unwrap().len(), 1);

    let (st, _) = call(&router, &format!("{EXPORT}/ListExports"), Some(&tm), json!({ "projectId": project })).await;
    assert_ne!(st, StatusCode::OK, "member must not read the export history");
}

#[tokio::test]
async fn a_former_owner_cannot_download_the_archive() {
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let heir = mk_user(&store, "Budi").await;
    let to = token(&owner);
    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Pindah {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": project, "userId": heir })).await;

    let job_id: i64 = ok(&router, &format!("{EXPORT}/StartExport"), &to, json!({ "projectId": project })).await["id"]
        .as_str().unwrap().parse().unwrap();
    let key = format!("exports/{project}/{job_id}.zip");
    fake.uploaded.lock().unwrap().insert(key.clone(), 42);
    store.mark_export_ready(job_id, &key, 42, "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z").await.unwrap();

    // The owner can download it now.
    let url = ok(&router, &format!("{EXPORT}/GetExportDownloadUrl"), &to, json!({ "id": job_id.to_string() })).await;
    assert!(url["url"].as_str().unwrap().contains(&key), "{url}");

    // Hand the project over.
    ok(&router, &format!("{PROJECT}/TransferProjectOwnership"), &to, json!({ "id": project, "newOwnerId": heir })).await;

    let (st, _) = call(&router, &format!("{EXPORT}/GetExportDownloadUrl"), Some(&to), json!({ "id": job_id.to_string() })).await;
    assert_ne!(st, StatusCode::OK, "a former owner must not keep downloading the archive");
    let heir_url = ok(&router, &format!("{EXPORT}/GetExportDownloadUrl"), &token(&heir), json!({ "id": job_id.to_string() })).await;
    assert!(heir_url["url"].as_str().unwrap().contains(&key), "the new owner can");
}

#[tokio::test]
async fn download_url_is_refused_while_the_archive_is_not_ready() {
    let Some((router, store, _fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let to = token(&owner);
    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Belum {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();
    let job_id = ok(&router, &format!("{EXPORT}/StartExport"), &to, json!({ "projectId": project })).await["id"]
        .as_str().unwrap().to_string();

    let (st, _) = call(&router, &format!("{EXPORT}/GetExportDownloadUrl"), Some(&to), json!({ "id": job_id })).await;
    assert_ne!(st, StatusCode::OK, "pending job has no archive to hand out");
}
```

- [ ] **Step 2: Run them**

Run: `cd apps/backend-rs && DATABASE_URL=… cargo test -p transport --test export_flow`
Expected: all pass. Note these tests never start the worker — they drive the rows directly, which is what keeps them deterministic. The worker itself is covered by the browser pass in Task 17.

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/transport/tests/export_flow.rs
git commit -m "test(export): cover queueing, dedupe, and the ownership-transfer trap"
```

## Task 16: Frontend — the archive half of the dialog

**Files:**
- Modify: `apps/frontend/src/features/exports/types.ts`
- Create: `apps/frontend/src/features/exports/api/mappers.ts`
- Modify: `apps/frontend/src/features/exports/api/hooks.ts`
- Modify: `apps/frontend/src/features/exports/components/export-dialog.tsx`
- Modify: `apps/frontend/src/features/exports/index.ts`
- Modify: `apps/frontend/src/features/notifications/api/hooks.ts`

- [ ] **Step 1: Regenerate the client**

Run: `cd apps/frontend && ./node_modules/.bin/buf generate`

- [ ] **Step 2: Add the flat types**

Append to `types.ts`:

```typescript
export type ExportJobStatus =
  | "pending"
  | "running"
  | "ready"
  | "failed"
  | "expired";

export type ExportJob = {
  id: string;
  projectId: string;
  requestedBy: string;
  status: ExportJobStatus;
  sizeBytes: number | null;
  fileTotal: number;
  fileDone: number;
  error: string | null;
  createdAt: string;
  expiresAt: string | null;
};
```

- [ ] **Step 3: Write `api/mappers.ts`**

```typescript
// Proto → flat. Components never see proto shapes.

import { ExportStatus, type ExportJob as PbExportJob } from "@/lib/gen/export_pb";
import type { ExportJob, ExportJobStatus } from "../types";

const STATUS: Record<number, ExportJobStatus> = {
  [ExportStatus.PENDING]: "pending",
  [ExportStatus.RUNNING]: "running",
  [ExportStatus.READY]: "ready",
  [ExportStatus.FAILED]: "failed",
  [ExportStatus.EXPIRED]: "expired",
};

export function mapExportJob(j: PbExportJob): ExportJob {
  return {
    id: j.id,
    projectId: j.projectId,
    requestedBy: j.requestedBy,
    status: STATUS[j.status] ?? "pending",
    sizeBytes: j.sizeBytes === undefined ? null : Number(j.sizeBytes),
    fileTotal: j.fileTotal,
    fileDone: j.fileDone,
    error: j.error ?? null,
    createdAt: j.createdAt,
    expiresAt: j.expiresAt ?? null,
  };
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
```

- [ ] **Step 4: Add the hooks**

Append to `api/hooks.ts`:

```typescript
import { useQuery, createConnectQueryKey } from "@connectrpc/connect-query";
import { queryClient } from "@/lib/query";
import type { ExportJob } from "../types";
import { mapExportJob } from "./mappers";

/** A project's recent exports. Polls only while something is actually running. */
export function useExports(projectId: string, enabled: boolean) {
  const result = useQuery(
    ExportService.method.listExports,
    { projectId },
    {
      enabled: enabled && !!projectId,
      refetchInterval: (query) => {
        const jobs = query.state.data?.jobs ?? [];
        const busy = jobs.some((j) => j.status === 1 || j.status === 2); // PENDING | RUNNING
        return busy ? 3000 : false;
      },
    },
  );
  const jobs: ExportJob[] = (result.data?.jobs ?? []).map(mapExportJob);
  return { ...result, jobs };
}

export function invalidateExports() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({ schema: ExportService, cardinality: "finite" }),
  });
}

export function useStartExport() {
  return useMutation(ExportService.method.startExport, {
    onSuccess: invalidateExports,
  });
}

export function useExportDownloadUrl() {
  return useMutation(ExportService.method.getExportDownloadUrl);
}
```

- [ ] **Step 5: Extend the dialog**

Add to `export-dialog.tsx` — a second card beside the CSV one, plus the history list:

```tsx
  const start = useStartExport();
  const download = useExportDownloadUrl();
  const { jobs } = useExports(projectId, open);
  const busy = jobs.some((j) => j.status === "pending" || j.status === "running");

  function onArchive() {
    start.mutate(
      { projectId },
      {
        onSuccess: () => toast.success("Building the archive. We'll tell you when it's ready."),
        onError: (err) => toast.error(err.message || "Could not start the export"),
      },
    );
  }

  function onDownload(id: string) {
    download.mutate(
      { id },
      {
        // Presigned S3 URLs are absolute — same HOST_LAN_IP constraint as media.
        onSuccess: (res) => window.location.assign(res.url),
        onError: (err) => toast.error(err.message || "Download failed"),
      },
    );
  }
```

```tsx
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Full archive (.zip)</p>
              <p className="text-sm text-text-muted">
                Everything: tasks, comments, pages, history, and every uploaded
                file. Built in the background.
              </p>
            </div>
            <Button size="sm" onClick={onArchive} disabled={busy || start.isPending}>
              {busy ? "Building…" : "Build archive"}
            </Button>
          </div>

          {jobs.length > 0 && (
            <ul className="space-y-2">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {j.status === "running"
                        ? `Building… ${j.fileDone}/${j.fileTotal} files`
                        : j.status === "pending"
                          ? "Queued"
                          : j.status === "ready"
                            ? `Ready · ${formatSize(j.sizeBytes)}`
                            : j.status === "expired"
                              ? "Expired · cleaned up"
                              : "Failed"}
                    </p>
                    <p className="text-text-muted">
                      {j.status === "failed" && j.error
                        ? j.error
                        : new Date(j.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {j.status === "ready" && (
                    <Button size="sm" variant="outline" onClick={() => onDownload(j.id)}>
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
```

Add `formatSize` to the imports from `../api/mappers`, and the new hooks from `../api/hooks`.

- [ ] **Step 6: Make the notification stream refresh the list**

`useNotificationStream` currently ignores the event body (`for await (const _event of stream)`) and only invalidates the notification queries. An export finishing is the first event that changes another feature's data, so the body now matters. In `features/notifications/api/hooks.ts` add these imports:

```typescript
import { NotificationType } from "@/lib/gen/notifications_pb";
import { invalidateExports } from "@/features/exports";
```

and replace the loop body inside `connect()`:

```typescript
        for await (const event of stream) {
          retry = 0; // a delivered event means the connection is healthy
          void invalidateNotifications();
          // The one event that changes another feature's data: refresh an
          // export dialog someone left open instead of making them reopen it.
          if (
            event.type === NotificationType.EXPORT_READY ||
            event.type === NotificationType.EXPORT_FAILED
          ) {
            void invalidateExports();
          }
        }
```

Change nothing else in that hook — the backoff, visibility and abort handling around it were debugged the hard way.

- [ ] **Step 7: Export the new pieces from the barrel**

```typescript
export type { ExportJob, ExportJobStatus } from "./types";
export { mapExportJob, formatSize } from "./api/mappers";
export {
  useExportTasksCsv,
  useExports,
  useStartExport,
  useExportDownloadUrl,
  invalidateExports,
  downloadText,
} from "./api/hooks";
```

- [ ] **Step 8: Verify the gates**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint && bun run build`
Expected: all three pass.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(export): build, track, and download a full project archive"
```

## Task 17: Drive it in a browser, then document the disk cost

Every one of the last two sub-projects shipped bugs past `tsc`, `lint`, `build` and code review. Everything below surfaces only when someone actually runs the app.

**Files:**
- Modify: `deploy/README.md`

- [ ] **Step 1: Run the stack against real S3**

`cd deploy && ./build.sh && podman-compose up -d --build`, then open http://localhost:3011 and log in as the seeded admin.

- [ ] **Step 2: Walk the archive path**

- A project **with** media: click Export → Build archive. Watch `file_done/file_total` move. Wait for the notification toast. Download it, open the ZIP: `export.json` parses, `tasks.csv` opens in a spreadsheet, `media/` holds the files and they open.
- Confirm `export.json` has `schema_version`, and that no `users` entry carries a phone number.
- A project with **no media at all**: the archive still builds and is a valid ZIP.
- Restart the backend while a build is running (`podman-compose restart backend-rs`): the job returns to `pending` and finishes on the next tick.
- A **member** (not owner) opens the project: no Export button at all.
- Delete a project that has a ready archive; confirm the download is refused immediately, and that within a minute the object is gone from the bucket (check the rustfs console at :9101).

- [ ] **Step 3: Write down the disk cost**

Add to `deploy/README.md`, under the media/presigned section:

```markdown
## Export archives

Building a project archive writes a temporary ZIP to the backend container's
temp dir, sized like the finished archive, plus one media file at a time. Peak
disk is roughly (archive size + largest file); both temp files are removed on
success and on failure. Finished archives live in the same S3 bucket under
`exports/<project_id>/` for 7 days, then the worker deletes them.

Archive downloads use presigned S3 URLs, so they are subject to the same
`HOST_LAN_IP` constraint as media downloads above.
```

- [ ] **Step 4: Commit**

```bash
git add deploy/README.md
git commit -m "docs(deploy): note the export worker's disk and retention costs"
```

---

## Self-review notes for the implementer

Three things this plan knowingly leaves thin, so you are not surprised:

0. **There are no frontend unit tests, because there is no frontend test runner.** The spec's verification table lists a row for mapper tests via `createRouterTransport`; the repo has no Vitest setup (CLAUDE.md says so plainly), and standing one up is its own piece of work with its own config, CI wiring and conventions. Rather than pretend, the frontend is covered by `tsc`, `lint`, `build` and the browser pass in Task 17. If you want the row the spec promises, add Vitest first as a separate change — do not bolt a half-configured runner onto this one.

1. **The worker has no automated test.** Its pieces do — `archive.rs` through the flow tests, `export.rs` transitions through unit tests, the RPCs through the guard matrix — but the claim-build-announce loop itself is only exercised by Task 17's browser pass. Adding a test that spawns the worker against a real database is possible and would be welcome; it was left out rather than faked, because a worker test with a mocked store proves nothing about the loop.
2. **`media_count` calls `gather` a second time** (once for the count, once inside `build_and_upload`). That is one wasted pass over the project's rows per job. It buys a progress denominator before the copy loop starts, and a job runs at most once per project at a time. If it shows up as a problem, have `build_and_upload` report the total through the `progress` callback instead of counting up front.
