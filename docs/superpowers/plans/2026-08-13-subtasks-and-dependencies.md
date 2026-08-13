# Subtasks & Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can be broken into subtasks one level deep, and can record which tasks must finish before it — with the resulting schedule conflicts visible on the timeline.

**Architecture:** Two new Arke components (`TaskParent`, `TaskBlockedBy`) shaped like the existing `TaskAssignees`/`TaskLabels`. Four invariants enforced in the handler. Conflicts are derived at render time from data already loaded, never stored. Dependency arrows go on the Gantt as a separate SVG overlay rather than into bar rendering.

**Tech Stack:** Rust (axum + connectrpc-axum + sqlx + Arke ECS over Postgres), proto3/Connect, React 19 + TanStack Router/Query + connect-query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-13-subtasks-and-dependencies-design.md`

---

## Before you start

**Environment.** Rust tests here **silently skip and still report `ok`** when their env var is missing — a skipped test is indistinguishable from a passing one in the summary. Every "expected: FAIL" step below is meaningless if tests are skipping.

```bash
cd apps/backend-rs
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/sedjiwa_tasks_rs
export ARKE_TEST_DATABASE_URL=$DATABASE_URL
```

Verify before writing code — this must print test output with no `skip:` line:

```bash
cargo test -p transport --test work_flow -- --nocapture
```

**Formatting.** This repo is **not** rustfmt-clean: `main` carries 193 pre-existing diffs. Never run `cargo fmt --all` or `cargo fmt -p <crate>`, and **never point `rustfmt` at a crate root** (`lib.rs`, `main.rs`) — it follows the `mod` tree and once reformatted 17 unrelated files. Format new leaf library files individually; hand-edit everything else. Flow tests are deliberately dense one-liners; leave them unformatted.

**Clippy** *is* clean workspace-wide at `-D warnings`. Keep it that way.

**Assertions.** Two tests in the previous sub-project passed no matter what the code did, because Postgres discards whole token categories before indexing. The rule that came out of it: **an assertion you have not watched fail is not a test.** For every behavioural assertion in this plan, break the thing it covers, confirm the failure, then revert. Report which ones you verified this way.

**Browser pass.** The previous sub-project's last two bugs — a URL form that silently did nothing, and a palette that could not be operated by keyboard — passed `tsc`, `lint`, `build`, and two rounds of code review. Task 14 exists because of that.

## File structure

**Backend — modified**

| File | Change |
|---|---|
| `crates/domain/src/task.rs` | `TaskParent`, `TaskBlockedBy` |
| `crates/domain/src/lib.rs` | register both |
| `proto/work.proto` | 4 new fields |
| `crates/transport/src/work/task_record.rs` | carry both through `TaskRecord`/`read_task`/`to_proto` |
| `crates/transport/src/work/task_service.rs` | invariants, create/update/move/delete wiring |
| `crates/transport/src/work/mod.rs` | shared parent/dependency helpers |
| `crates/transport/src/search/indexer.rs` | `task_doc` carries `parent_id` |
| `crates/persistence/src/search.rs` | `parent_id` column |
| `crates/transport/src/search/search_service.rs` | `parent_id` on results |
| `proto/search.proto` | `parent_id` on `SearchResult` |
| `crates/app/src/bin/reindex.rs` | keep the field mapping in step |

**Frontend — new**

| File | Responsibility |
|---|---|
| `src/features/tasks/components/subtask-section.tsx` | Subtask list + inline quick-add, for the dialog |
| `src/features/tasks/components/dependency-picker.tsx` | "Blocked by" picker |
| `src/features/tasks/task-graph.ts` | Pure helpers: hierarchy, reverse index, conflict detection |
| `src/features/timeline/components/dependency-layer.tsx` | SVG arrow overlay |

**Frontend — modified**

`src/features/tasks/types.ts` · `api/mappers.ts` · `api/hooks.ts` · `components/module-section.tsx` · `components/task-row.tsx` · `components/task-dialog.tsx` · `components/all-tasks-tab.tsx` · `src/features/timeline/components/gantt-chart.tsx` · `src/features/search/types.ts` + `api/mappers.ts`

---

## Phase 1 — Model and invariants

### Task 1: The two components

**Files:** `crates/domain/src/task.rs`, `crates/domain/src/lib.rs`

- [ ] **Step 1: Add the components**

In `crates/domain/src/task.rs`, after `TaskLabels`:

```rust
/// A subtask's parent task (`pid` string). Absent = top-level task.
///
/// Exactly one level is allowed: a task carrying this component may not itself
/// be a parent. That rule lives in the handler, and it is what makes cycles
/// structurally impossible rather than merely unlikely.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskParent {
    #[pg(index)]
    pub parent_id: String,
}

/// Finish-to-start dependencies (JSONB): tasks that should finish before this
/// one starts. Stored one-directional — the reverse index ("what do I block")
/// is built in the frontend from the project's already-loaded task list, so
/// there is nothing to keep in sync here.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskBlockedBy {
    pub task_ids: Vec<String>,
}
```

- [ ] **Step 2: Register them**

In `crates/domain/src/lib.rs`, in the Tasks block after `pg.register::<task::TaskAudit>();`:

```rust
    pg.register::<task::TaskParent>();
    pg.register::<task::TaskBlockedBy>();
```

- [ ] **Step 3: Verify the tables are created**

Run: `cargo test -p persistence -- --nocapture`
Expected: passes with no `skip:` line. `Store::connect` runs `pg.migrate()`, which creates `cmp_taskparent` and `cmp_taskblockedby` on first connect.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-rs/crates/domain/src/task.rs apps/backend-rs/crates/domain/src/lib.rs
git commit -m "feat(domain): add TaskParent and TaskBlockedBy components"
```

---

### Task 2: Carry both through the record layer

**Files:** `crates/transport/src/work/task_record.rs`, `proto/work.proto`

- [ ] **Step 1: Extend the proto**

In `proto/work.proto`, inside `message Task` after `string created_by = 15;`:

```proto
  optional string parent_id = 16;
  repeated string blocked_by_ids = 17;
```

In `message CreateTaskRequest`, after `repeated string label_ids = 9;`:

```proto
  optional string parent_id = 10;
```

In `message UpdateTaskRequest`, after `optional StringList label_ids = 9;`:

```proto
  optional StringList blocked_by_ids = 10;
  // Re-parenting needs three states — leave alone, set a parent, detach to top
  // level — which a bare `optional string` cannot express (absent and "clear"
  // collapse into the same value). Reuse the StringList wrapper: absent =
  // unchanged, empty = detach, one element = that parent. Two or more is an
  // invalid argument.
  optional StringList parent_id_set = 11;
```

- [ ] **Step 2: Extend `TaskRecord`**

In `crates/transport/src/work/task_record.rs`, add to the struct after `pub created_by: String,`:

```rust
    pub parent_id: Option<String>,
    pub blocked_by_ids: Vec<String>,
```

In `read_task`, after the `label_ids` field:

```rust
        parent_id: world.get::<TaskParent>(e).map(|p| p.parent_id.clone()),
        blocked_by_ids: world
            .get::<TaskBlockedBy>(e)
            .map(|b| b.task_ids.clone())
            .unwrap_or_default(),
```

In `to_proto`, after `created_by`:

```rust
        parent_id: t.parent_id.clone(),
        blocked_by_ids: t.blocked_by_ids.clone(),
```

Extend the `use domain::task::{…}` import with `TaskBlockedBy, TaskParent`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p transport`
Expected: success. Existing tests still pass — both fields default to absent/empty for every existing task.

- [ ] **Step 4: Run the existing suites to prove nothing regressed**

Run: `cargo test -p transport --test work_flow -- --nocapture`
Expected: all pass, no `skip:` line.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/proto/work.proto apps/backend-rs/crates/transport/src/work/task_record.rs
git commit -m "feat(work): carry parent and blocked-by through the task record"
```

---

### Task 3: Invariant helpers

**Files:** `crates/transport/src/work/mod.rs`

These four checks are the whole safety story for this feature, so they live in
one place rather than being inlined at each call site.

- [ ] **Step 1: Write the helpers**

Add to `crates/transport/src/work/mod.rs`:

```rust
/// Validate a proposed parent for `child_pid` (which may be 0 on create).
///
/// Returns the parent's module id, because a subtask always lives in its
/// parent's module and the caller needs it. Rejects: a missing parent, a parent
/// in another project, a parent that is itself a subtask (the one-level rule),
/// and a task parenting itself.
pub(crate) async fn validate_parent(
    store: &Store,
    project_id: &str,
    parent_id: &str,
    child_pid: i64,
) -> Result<String, ConnectError> {
    let ppid = parse_pid(parent_id)?;
    if ppid == child_pid {
        return Err(ConnectError::new_invalid_argument(
            "a task cannot be its own parent",
        ));
    }
    let parent = task_record::load_task(store, ppid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("parent task not found"))?;
    if parent.parent_id.is_some() {
        return Err(ConnectError::new_invalid_argument(
            "a subtask cannot have subtasks",
        ));
    }
    let parent_project = task_project_id(store, parent_id)
        .await
        .map_err(internal)?
        .unwrap_or_default();
    if parent_project != project_id {
        return Err(ConnectError::new_invalid_argument(
            "parent task must be in the same project",
        ));
    }
    Ok(parent.module_id)
}

/// Validate `blocked_by` ids for a task in `project_id`. Rejects a
/// self-dependency and any id outside the project. Duplicates are collapsed.
///
/// Deliberately does NOT look for cycles: dependencies only warn, and conflicts
/// are computed per edge, so nothing ever walks the chain. See the spec's
/// "Consequence: no cycle detection is needed".
pub(crate) async fn validate_blocked_by(
    store: &Store,
    project_id: &str,
    task_pid: i64,
    ids: &[String],
) -> Result<Vec<String>, ConnectError> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        if id == &task_pid.to_string() {
            return Err(ConnectError::new_invalid_argument(
                "a task cannot block itself",
            ));
        }
        if !seen.insert(id.clone()) {
            continue;
        }
        let owner = task_project_id(store, id).await.map_err(internal)?;
        match owner {
            Some(p) if p == project_id => out.push(id.clone()),
            _ => {
                return Err(ConnectError::new_invalid_argument(
                    "every dependency must be a task in the same project",
                ))
            }
        }
    }
    Ok(out)
}

/// Subtask `pid`s of a parent (for cascade delete and module moves).
pub(crate) async fn subtask_pids(store: &Store, parent_id: &str) -> anyhow::Result<Vec<i64>> {
    let p = parent_id.to_string();
    store
        .query::<domain::task::TaskParent, i64>(None, move |world, pairs| {
            pairs
                .iter()
                .filter(|(_, e)| {
                    world
                        .get::<domain::task::TaskParent>(*e)
                        .map(|r| r.parent_id == p)
                        .unwrap_or(false)
                })
                .map(|(pid, _)| *pid)
                .collect()
        })
        .await
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p transport`
Expected: success, with dead-code warnings for the not-yet-called helpers. If those break the clippy gate, follow the precedent already in `crates/transport/src/search/mod.rs` rather than inventing a new mechanism — and remove the allow once Task 4 wires them up.

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/transport/src/work/mod.rs
git commit -m "feat(work): add parent and dependency invariant helpers"
```

---

### Task 4: Wire the invariants into the handlers

**Files:** `crates/transport/src/work/task_service.rs`, `crates/transport/tests/work_flow.rs`

- [ ] **Step 1: Write the failing tests**

Append to `crates/transport/tests/work_flow.rs`, adapting to that file's existing helper names (`setup`, `mk_user`, `project_with`, `token`, `ok`, `call`, and the `MODULE`/`TASK` constants):

```rust
#[tokio::test]
async fn subtask_rules_are_enforced() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M1" })).await["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M2" })).await["id"].as_str().unwrap().to_string();

    let parent = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "Parent" })).await["id"].as_str().unwrap().to_string();

    // A subtask takes its parent's module even when the request names another.
    let sub = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m2, "title": "Sub", "parentId": parent
    })).await;
    assert_eq!(sub["parentId"], parent);
    assert_eq!(sub["moduleId"], m1, "subtask follows its parent's module, not the request");
    let sub_id = sub["id"].as_str().unwrap().to_string();

    // One level: a subtask cannot be a parent, on create...
    let (st, _) = call(&router, &format!("{TASK}/CreateTask"), Some(&to), json!({
        "moduleId": m1, "title": "Grandchild", "parentId": sub_id
    })).await;
    assert_ne!(st, StatusCode::OK, "a subtask cannot have subtasks");

    // ...and on update.
    let other = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "Other" })).await["id"].as_str().unwrap().to_string();
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": other, "parentIdSet": { "values": [sub_id] }
    })).await;
    assert_ne!(st, StatusCode::OK, "cannot re-parent under a subtask");

    // A task cannot parent itself.
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": other, "parentIdSet": { "values": [other] }
    })).await;
    assert_ne!(st, StatusCode::OK, "self-parenting rejected");

    // Re-parent: absent leaves alone, empty detaches, one element sets.
    let unchanged = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": sub_id, "title": "Sub renamed" })).await;
    assert_eq!(unchanged["parentId"], parent, "absent parentIdSet leaves the parent alone");

    let detached = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": sub_id, "parentIdSet": { "values": [] }
    })).await;
    assert!(detached["parentId"].is_null(), "empty list detaches to top level");

    let reattached = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": sub_id, "parentIdSet": { "values": [parent] }
    })).await;
    assert_eq!(reattached["parentId"], parent, "one element sets the parent");

    // Moving the parent moves its subtasks.
    ok(&router, &format!("{TASK}/MoveTask"), &to, json!({ "id": parent, "moduleId": m2, "order": 0 })).await;
    let moved_sub = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": sub_id })).await;
    assert_eq!(moved_sub["moduleId"], m2, "subtask followed its parent to the new module");

    // Deleting the parent deletes its subtasks.
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": parent })).await;
    let (st, _) = call(&router, &format!("{TASK}/GetTask"), Some(&to), json!({ "id": sub_id })).await;
    assert_ne!(st, StatusCode::OK, "subtask deleted with its parent");
}

#[tokio::test]
async fn dependency_rules_are_enforced() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let p1 = project_with(&router, &owner, &[]).await;
    let p2 = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p1, "name": "M" })).await["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p2, "name": "M" })).await["id"].as_str().unwrap().to_string();

    let a = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "A" })).await["id"].as_str().unwrap().to_string();
    let b = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "B" })).await["id"].as_str().unwrap().to_string();
    let foreign = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m2, "title": "Foreign" })).await["id"].as_str().unwrap().to_string();

    // Set and read back.
    let updated = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": b, "blockedByIds": { "values": [a] }
    })).await;
    assert_eq!(updated["blockedByIds"], json!([a]));

    // Absent leaves it alone; empty clears it.
    let untouched = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": b, "title": "B2" })).await;
    assert_eq!(untouched["blockedByIds"], json!([a]), "absent wrapper leaves dependencies alone");
    let cleared = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": b, "blockedByIds": { "values": [] }
    })).await;
    assert_eq!(cleared["blockedByIds"], json!([]), "empty wrapper clears");

    // Self-dependency and cross-project are rejected.
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": b, "blockedByIds": { "values": [b] }
    })).await;
    assert_ne!(st, StatusCode::OK, "self-dependency rejected");
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": b, "blockedByIds": { "values": [foreign] }
    })).await;
    assert_ne!(st, StatusCode::OK, "cross-project dependency rejected");

    // A cycle is ACCEPTED. Nothing walks the graph, so it cannot hang; the user
    // sees both arrows and both conflict marks and judges for themselves.
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": b, "blockedByIds": { "values": [a] } })).await;
    let a_now = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": a, "blockedByIds": { "values": [b] } })).await;
    assert_eq!(a_now["blockedByIds"], json!([b]), "a cycle is allowed by design");

    // Deleting a task strips it from other tasks' dependencies.
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": a })).await;
    let b_after = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": b })).await;
    assert_eq!(b_after["blockedByIds"], json!([]), "dangling dependency removed on delete");
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p transport --test work_flow subtask_rules -- --nocapture`
Expected: FAIL — `parentId` is not yet accepted, so the subtask comes back with a null parent and the module assertion fails.

- [ ] **Step 3: Implement in `task_service.rs`**

Import: `use domain::task::{TaskBlockedBy, TaskParent};` (extend the existing `domain::task` import) and `use super::{subtask_pids, validate_blocked_by, validate_parent};`.

**`create_task`** — before computing `order`, resolve the parent and override the module:

```rust
    // A subtask lives in its parent's module; the request's module_id is
    // ignored rather than trusted, so the invariant cannot be bypassed.
    let (module_id, parent_id) = match r.parent_id.as_deref().filter(|s| !s.is_empty()) {
        Some(p) => (validate_parent(&store, &project_id, p, 0).await?, Some(p.to_string())),
        None => (r.module_id.clone(), None),
    };
```

Use `module_id` for `next_order_in_module` and for `TaskModuleRef`. After the bundle create, attach the parent when present:

```rust
    if let Some(p) = &parent_id {
        let p = p.clone();
        store
            .update(pid, move |w, e| { w.insert(e, TaskParent { parent_id: p }); })
            .await
            .map_err(internal)?;
    }
```

**`update_task`** — after the labels block, resolve both new fields:

```rust
    // Dependencies: present wrapper = replace, absent = unchanged.
    let blocked_by = match r.blocked_by_ids {
        Some(list) => validate_blocked_by(&store, &project_id, pid, &list.values).await?,
        None => t.blocked_by_ids.clone(),
    };
    // Re-parenting: absent = unchanged, empty = detach, one = set.
    let new_parent: Option<Option<String>> = match r.parent_id_set {
        None => None,
        Some(list) if list.values.is_empty() => Some(None),
        Some(list) if list.values.len() == 1 => {
            let p = list.values[0].clone();
            validate_parent(&store, &project_id, &p, pid).await?;
            Some(Some(p))
        }
        Some(_) => {
            return Err(ConnectError::new_invalid_argument(
                "parent_id_set takes at most one id",
            ))
        }
    };
```

In the `store.update` closure, replace `TaskBlockedBy` unconditionally and apply `new_parent` only when it is `Some`:

```rust
            w.remove::<TaskBlockedBy>(e);
            w.insert(e, TaskBlockedBy { task_ids: blocked_by });
            if let Some(p) = new_parent {
                w.remove::<TaskParent>(e);
                if let Some(pid_str) = p {
                    w.insert(e, TaskParent { parent_id: pid_str });
                }
            }
```

Note the existing closure is `move`, so clone anything still needed afterwards.

**`move_task`** — after the module change is written, move the subtasks with it:

```rust
    // A subtask always lives in its parent's module; moving the parent moves
    // the children rather than leaving them behind in the old module.
    for spid in subtask_pids(&store, &pid.to_string()).await.map_err(internal)? {
        let mid = module_id.clone();
        store
            .update(spid, move |w, e| {
                w.remove::<TaskModuleRef>(e);
                w.insert(e, TaskModuleRef { module_id: mid });
            })
            .await
            .map_err(internal)?;
    }
```

Use whatever local holds the destination module id in that handler.

**`delete_task`** — before deleting the task itself, delete its subtasks, and afterwards strip dangling dependencies:

```rust
    // Cascade to subtasks first, so each leaves the search index too.
    for spid in subtask_pids(&store, &pid.to_string()).await.map_err(internal)? {
        store.delete(spid).await.map_err(internal)?;
        super::deindex_task_and_comments(&store, &spid.to_string()).await;
    }
```

and after the task delete:

```rust
    // Drop this id from every task that listed it as a blocker, or those lists
    // accumulate ids that resolve to nothing and cannot be rendered.
    strip_dependency(&store, &project_id, &pid.to_string()).await.map_err(internal)?;
```

Add `strip_dependency` to `work/mod.rs`:

```rust
/// Remove `gone_id` from every task in the project that listed it as a blocker.
///
/// Called after a task is deleted. Without it `blocked_by` accumulates ids that
/// resolve to nothing: the frontend skips them when building conflicts, so they
/// are invisible rather than broken — which is exactly why they would otherwise
/// never get cleaned up.
pub(crate) async fn strip_dependency(
    store: &Store,
    project_id: &str,
    gone_id: &str,
) -> anyhow::Result<()> {
    let module_ids: std::collections::HashSet<String> = record::modules_for_project(store, project_id)
        .await?
        .into_iter()
        .map(|m| m.pid.to_string())
        .collect();
    for t in task_record::tasks_for_modules(store, module_ids).await? {
        if !t.blocked_by_ids.iter().any(|b| b == gone_id) {
            continue;
        }
        let kept: Vec<String> = t
            .blocked_by_ids
            .iter()
            .filter(|b| *b != gone_id)
            .cloned()
            .collect();
        store
            .update(t.pid, move |w, e| {
                w.remove::<domain::task::TaskBlockedBy>(e);
                w.insert(e, domain::task::TaskBlockedBy { task_ids: kept });
            })
            .await?;
    }
    Ok(())
}
```

`modules_for_project` and `tasks_for_modules` already exist in `record.rs` and
`task_record.rs` respectively — this is the same pair `list_tasks` uses, so it
adds no new query shape.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p transport --test work_flow -- --nocapture`
Expected: both new tests pass plus all existing ones, no `skip:` line.

- [ ] **Step 5: Verify the assertions discriminate**

For each, break it, watch it fail, revert:
- One-level rule: remove the `parent.parent_id.is_some()` check in `validate_parent`.
- Module inheritance: use `r.module_id` instead of the validated parent's module.
- Dependency strip on delete: comment out the `strip_dependency` call.

Report which you did.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/transport
git commit -m "feat(work): enforce one-level subtasks and same-project dependencies"
```

---

### Task 5: Search carries the parent

**Files:** `crates/persistence/src/search.rs`, `proto/search.proto`, `crates/transport/src/search/{indexer.rs,search_service.rs}`, `crates/app/src/bin/reindex.rs`, `crates/transport/tests/search_flow.rs`

- [ ] **Step 1: Add the column**

In `crates/persistence/src/search.rs`: add `parent_id text` to the `search_doc` DDL, to `SearchDoc`, to `SearchRow`, to the `index_doc` insert **and its `ON CONFLICT DO UPDATE` set-list**, and to the `search` SELECT column list.

**The DDL alone is not enough.** `migrate()` uses `CREATE TABLE IF NOT EXISTS`, so every database that already has `search_doc` — including yours — will silently skip the new column and every `index_doc` will then fail. Add this immediately after the `CREATE TABLE`, with a comment saying why:

```rust
    // CREATE TABLE IF NOT EXISTS does nothing on a database that already has
    // search_doc, so a column added later must be applied separately. Same
    // trap as TS_CONFIG above: the create silently succeeds and the change
    // silently does not happen.
    sqlx::query("ALTER TABLE search_doc ADD COLUMN IF NOT EXISTS parent_id text")
        .execute(pool)
        .await?;
```

- [ ] **Step 2: Thread it through**

- `indexer.rs`: `SearchDoc` now has a `parent_id` field, so **all five** builders must set it — `task_doc` gains a `parent_id: Option<String>` argument and passes it through; `page_doc`, `comment_doc`, `project_doc`, and `user_doc` set `parent_id: None`.
- `search.proto`: `optional string parent_id = 9;` on `SearchResult`.
- `search_service.rs`: map `row.parent_id` onto the response.
- `reindex.rs`: read `TaskParent` in the task walk and set it. The binary constructs `SearchDoc` directly rather than calling the builders, so its field mapping must stay identical to `indexer.rs` — if the two drift, a rebuilt index disagrees with a live-written one.

- [ ] **Step 3: Test**

Add to `crates/transport/tests/search_flow.rs`: create a parent and a subtask with a unique term, assert the subtask is findable and its result's `parentId` is the parent's id. Then delete the parent and assert **both** documents are gone.

- [ ] **Step 4: Run**

Run: `cargo test -p transport --test search_flow -- --nocapture`
Expected: all pass, no `skip:` line.

- [ ] **Step 5: Rebuild the index**

Run: `cargo run --bin reindex`
Expected: `reindexed N documents`. Existing rows have no `parent_id` until this runs.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs
git commit -m "feat(search): carry a subtask's parent into search results"
```

---

### Task 6: Backend gate

- [ ] **Step 1: Run everything**

```bash
cd apps/backend-rs
rustfmt --edition 2021 --check crates/persistence/src/search.rs crates/transport/src/search/mod.rs crates/transport/src/search/indexer.rs crates/transport/src/search/search_service.rs
cargo clippy --all-targets -- -D warnings
cargo test --workspace -- --nocapture 2>&1 | grep -c "^skip:"
cargo test --workspace
```

Expected: rustfmt silent, clippy clean, skip count `0`, everything passing.

---

## Phase 2 — Frontend

### Task 7: Types, mappers, hooks

**Files:** `src/features/tasks/types.ts`, `api/mappers.ts`, `api/hooks.ts`, `src/features/search/{types.ts,api/mappers.ts}`

- [ ] **Step 1: Regenerate**

```bash
cd apps/frontend && ./node_modules/.bin/buf generate
```

- [ ] **Step 2: Extend the flat types**

In `src/features/tasks/types.ts`, on `Task`, after `createdBy: string;`:

```typescript
  /** Set when this task is a subtask. One level only — a subtask has none. */
  parentId?: string;
  /** Tasks that should finish before this one starts (finish-to-start). */
  blockedByIds: string[];
```

In `api/mappers.ts`, in `mapTask`, after `createdBy: t.createdBy,`:

```typescript
    parentId: t.parentId,
    blockedByIds: t.blockedByIds,
```

In `src/features/search/types.ts`, on `SearchHit`:

```typescript
  /** Task hits that are subtasks: the parent's id, for context in the row. */
  parentId?: string;
```

and the corresponding `parentId: r.parentId,` in its mapper.

- [ ] **Step 3: Extend the mutation hooks**

`useUpdateTask` already passes through to the RPC, so `blockedByIds` and `parentIdSet` need no hook change — verify that by reading `api/hooks.ts` rather than assuming. `useCreateTask` likewise carries `parentId` straight through.

- [ ] **Step 4: Gate**

Run: `bun run tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/gen apps/frontend/src/features/tasks apps/frontend/src/features/search
git commit -m "feat(tasks): map parent and dependency fields to the flat types"
```

---

### Task 8: The pure graph helpers

**Files:** `src/features/tasks/task-graph.ts` (create)

Everything derived lives here, in pure functions over the already-loaded task
list — no hooks, no fetching. That is what keeps the conflict rules testable by
reading them, and keeps `gantt-chart.tsx` from growing.

- [ ] **Step 1: Write it**

```typescript
// Derived views over a project's task list. Everything here is computed at
// render time from data already loaded — nothing is stored, so nothing can go
// stale. `ListTasks` returns every task in the project, which is what makes the
// reverse dependency index free.

import type { Task } from "./types";

/** Top-level tasks, and each parent's children in `order`. */
export function buildHierarchy(tasks: Task[]): {
  roots: Task[];
  childrenOf: Record<string, Task[]>;
} {
  const childrenOf: Record<string, Task[]> = {};
  const roots: Task[] = [];
  for (const t of tasks) {
    if (t.parentId) (childrenOf[t.parentId] ??= []).push(t);
    else roots.push(t);
  }
  for (const id of Object.keys(childrenOf)) {
    childrenOf[id].sort((a, b) => a.order - b.order);
  }
  roots.sort((a, b) => a.order - b.order);
  return { roots, childrenOf };
}

/** `2/3` progress for a parent. Returns null when it has no children. */
export function subtaskProgress(
  task: Task,
  childrenOf: Record<string, Task[]>,
): { done: number; total: number } | null {
  const kids = childrenOf[task.id];
  if (!kids?.length) return null;
  return { done: kids.filter((k) => k.status === "done").length, total: kids.length };
}

/** taskId → the tasks it blocks. Built from the one-directional store field. */
export function reverseDependencies(tasks: Task[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tasks) {
    for (const b of t.blockedByIds) (out[b] ??= []).push(t.id);
  }
  return out;
}

export type ConflictKind = "schedule" | "status";

/**
 * Conflicts on the edge blocker → task.
 *
 * `schedule`: the dependent starts before its blocker is due to finish.
 * `status`:   the dependent is already underway while its blocker is not done.
 *
 * A missing date yields no schedule conflict — nothing is guessed. Evaluated
 * per edge, never by walking the chain, which is why a dependency cycle is
 * harmless here.
 */
export function edgeConflicts(blocker: Task, dependent: Task): ConflictKind[] {
  const out: ConflictKind[] = [];
  if (dependent.startDate && blocker.dueDate && dependent.startDate < blocker.dueDate) {
    out.push("schedule");
  }
  if (
    (dependent.status === "in_progress" || dependent.status === "done") &&
    blocker.status !== "done"
  ) {
    out.push("status");
  }
  return out;
}

/** Every conflicting edge in the project, for the timeline and the badges. */
export function allConflicts(
  tasks: Task[],
): { blockerId: string; dependentId: string; kinds: ConflictKind[] }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: { blockerId: string; dependentId: string; kinds: ConflictKind[] }[] = [];
  for (const t of tasks) {
    for (const bId of t.blockedByIds) {
      const blocker = byId.get(bId);
      if (!blocker) continue; // deleted mid-session; the backend strips these
      const kinds = edgeConflicts(blocker, t);
      if (kinds.length) out.push({ blockerId: bId, dependentId: t.id, kinds });
    }
  }
  return out;
}
```

Date comparison is lexicographic on ISO `yyyy-MM-dd`, which is correct and
matches how `timeline-utils.ts` already treats these strings.

- [ ] **Step 2: Gate**

Run: `bun run tsc --noEmit && bun run lint`
Expected: clean. There is no test framework here — these functions are written
to be verifiable by reading, which is why they are pure and separate.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/features/tasks/task-graph.ts
git commit -m "feat(tasks): derive hierarchy, reverse deps, and conflicts"
```

---

### Task 9: Subtasks in the task list

**Files:** `src/features/tasks/components/module-section.tsx`, `task-row.tsx`, `all-tasks-tab.tsx`

- [ ] **Step 1: Group by parent**

`ModuleSection` receives the module's tasks flat. Use `buildHierarchy` to render roots in `order` with their children indented beneath. Pass a `depth` prop to `TaskRow` and indent with padding rather than nesting a second `SortableContext` — dragging a subtask between parents is out of scope, and a nested sortable context would imply otherwise.

- [ ] **Step 2: Progress and blocked badges on the row**

`TaskRow` takes `progress?: { done: number; total: number }` and `blocked?: boolean`. Render the count next to the title, and a badge when blocked. Keep the badge a button that calls `onEdit(task)` so it lands in the dialog's dependency section.

- [ ] **Step 3: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks
git commit -m "feat(tasks): show subtasks indented with progress and blocked badges"
```

---

### Task 10: Dialog sections

**Files:** `src/features/tasks/components/{subtask-section.tsx,dependency-picker.tsx,task-dialog.tsx}` (first two new)

- [ ] **Step 1: `subtask-section.tsx`**

```typescript
export function SubtaskSection({
  parent,
  children,
  onOpenTask,
}: {
  parent: Task;
  /** Already sorted by `order` — from buildHierarchy's childrenOf. */
  children: Task[];
  /** Opens a subtask in the URL-addressed dialog (`?task=`). */
  onOpenTask: (id: string) => void;
}) { … }
```

Renders the list with status checkboxes and an inline quick-add input that calls `useCreateTask` with `parentId` set and the parent's `moduleId`. Each row opens that subtask via `onOpenTask` — which the dialog wires to the URL `?task=` param from the previous sub-project, so a subtask gets a shareable link for free.

Only render this section for a task that is **not** itself a subtask. A subtask's dialog instead shows a link back to its parent.

- [ ] **Step 2: `dependency-picker.tsx`**

```typescript
export function DependencyPicker({
  task,
  candidates,
  onChange,
}: {
  task: Task;
  /** The project's other tasks, already excluding `task` and its subtasks. */
  candidates: Task[];
  onChange: (blockedByIds: string[]) => void;
}) { … }
```

A "Blocked by" multi-select over the project's other tasks. Exclude the task itself and its own subtasks from the options. On change, call `useUpdateTask` with `blockedByIds: { values: [...] }`. Show each selected dependency with its status, and mark it when `edgeConflicts` reports one.

Follow the interaction pattern of `LabelCombobox` in `src/features/labels/` — read it first; do not introduce a third selector idiom.

- [ ] **Step 3: Mount both in `task-dialog.tsx`**

Below the description, above Comments. Both only in edit mode — a task being created has no id to hang children or dependencies on.

- [ ] **Step 4: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks
git commit -m "feat(tasks): add subtask and dependency sections to the dialog"
```

---

### Task 11: Timeline arrows and conflict marks

**Files:** `src/features/timeline/components/dependency-layer.tsx` (create), `gantt-chart.tsx`

- [ ] **Step 1: The overlay**

```typescript
export function DependencyLayer({
  tasks,
  rowTop,
  rangeStart,
  pxPerDay,
  width,
  height,
}: {
  tasks: Task[];
  /** taskId → the row's y offset in px. Absent = that task has no visible row. */
  rowTop: Record<string, number>;
  rangeStart: Date;
  pxPerDay: number;
  width: number;
  height: number;
}) { … }
```

It renders one absolutely-positioned `<svg>` covering the same grid, drawing a path per dependency edge from the blocker's bar end to the dependent's bar start, using `barGeometry` from `timeline-utils.ts` for x positions and `ROW_HEIGHT` for y.

Conflicting edges are drawn distinctly. Give the svg `pointer-events: none` so it never intercepts the drag interactions the chart already owns.

**Do not put this inside `gantt-chart.tsx`.** That file is already 320 lines and owns rows, geometry, zoom, and drag; a separate layer is what keeps it comprehensible.

- [ ] **Step 2: Mount it and indent subtasks**

In `gantt-chart.tsx`, build rows with `buildHierarchy` so subtasks appear indented beneath their parents, and render `<DependencyLayer>` over the grid. Mark bars involved in a conflict.

- [ ] **Step 3: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/timeline
git commit -m "feat(timeline): draw dependency arrows and mark conflicts"
```

---

### Task 12: Frontend gate

- [ ] **Step 1**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint && bun run build
```

Expected: clean; no new lint errors. Commit `routeTree.gen.ts` if the build changed it.

---

### Task 13: Browser pass

The previous sub-project shipped two bugs that every automated gate missed. This
task exists so that does not repeat. **You need a signed-in session; if you do
not have one, stop and ask — do not type a password into a login form.**

- [ ] **Step 1: Start the app**

Backend on :3010 (`cargo run --bin app`), frontend on :3001 (`bun run dev`). If :3010 is taken by someone else's process, do not kill it — run yours on another port and point the dev server at it with `VITE_TASKS_RS_BASE_URL`.

- [ ] **Step 2: Walk the feature**

1. Create a task; add two subtasks via quick-add. The parent shows `0/2`.
2. Complete one subtask. The parent shows `1/2` and its own status is unchanged.
3. Open a subtask. Its URL carries `?task=`, and it shows a link back to its parent.
4. Give two sibling tasks dates, make B blocked by A, and set B to start before A's due date. The timeline draws an arrow and marks the conflict.
5. Set B to In progress while A is still To do. The blocked badge appears on the row.
6. Search a subtask's title in Cmd+K. It appears, with the parent as context.
7. Delete the parent. The confirmation names the subtask count; afterwards neither parent nor subtasks appear in search.
8. Make A blocked by B while B is blocked by A. Both arrows render and nothing hangs.

- [ ] **Step 3: Report**

Anything that does not behave as described is a finding, not a nuisance — report it with what you did and what happened.
