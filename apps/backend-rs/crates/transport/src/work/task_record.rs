//! Task rows ↔ proto, plus every read and write the task flows make.
//!
//! Plain sqlx over the component tables of `persistence/src/schema.sql` (see
//! `persistence::entity`). A task is one entity carrying `cmp_taskinfo`,
//! `cmp_taskmoduleref` and `cmp_taskaudit`, optionally `cmp_taskassignees`,
//! `cmp_tasklabels`, `cmp_taskparent` and `cmp_taskblockedby`. The id lists
//! are JSONB arrays of strings; they cross the wire as `text[]` (see
//! [`ids_sql`] and [`upsert_ids`]) so no sqlx JSON support is needed.

use std::collections::HashSet;

use domain::task::{TaskPriority, TaskStatus};
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};

use crate::sedjiwa::tasks::work::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct TaskRecord {
    pub pid: i64,
    pub module_id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub order: i32,
    pub assignee_ids: Vec<String>,
    pub label_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub created_by: String,
    pub parent_id: Option<String>,
    pub blocked_by_ids: Vec<String>,
}

/// A JSONB string array as `text[]`, in array order; empty when the row is
/// absent (the LEFT JOIN left `col` NULL).
macro_rules! ids_sql {
    ($col:literal) => {
        concat!(
            "ARRAY(SELECT e.x FROM jsonb_array_elements_text(",
            $col,
            ") WITH ORDINALITY AS e(x, n) ORDER BY e.n)"
        )
    };
}

/// Info, module and audit are what make an entity a task.
const SELECT_TASK: &str = concat!(
    "SELECT i.pid, m.module_id, i.title, i.description, i.status, i.priority, \
           i.start_date, i.due_date, i.sort_order, \
           a.created_at, a.updated_at, a.completed_at, a.created_by, par.parent_id, ",
    ids_sql!("asg.user_ids"), " AS user_ids, ",
    ids_sql!("lab.label_ids"), " AS label_ids, ",
    ids_sql!("blk.task_ids"), " AS task_ids \
    FROM cmp_taskinfo i \
    JOIN cmp_taskmoduleref m ON m.pid = i.pid \
    JOIN cmp_taskaudit a ON a.pid = i.pid \
    LEFT JOIN cmp_taskassignees asg ON asg.pid = i.pid \
    LEFT JOIN cmp_tasklabels lab ON lab.pid = i.pid \
    LEFT JOIN cmp_taskparent par ON par.pid = i.pid \
    LEFT JOIN cmp_taskblockedby blk ON blk.pid = i.pid"
);

fn ids(row: &PgRow, col: &str) -> sqlx::Result<Vec<String>> {
    row.try_get(col)
}

/// `None` for a stored status or priority this build does not know, which
/// drops the row.
fn read_task(row: &PgRow) -> sqlx::Result<Option<TaskRecord>> {
    let status: String = row.try_get("status")?;
    let priority: String = row.try_get("priority")?;
    let (Some(status), Some(priority)) = (TaskStatus::parse(&status), TaskPriority::parse(&priority))
    else {
        return Ok(None);
    };
    Ok(Some(TaskRecord {
        pid: row.try_get("pid")?,
        module_id: row.try_get("module_id")?,
        title: row.try_get("title")?,
        description: row.try_get("description")?,
        status,
        priority,
        start_date: row.try_get("start_date")?,
        due_date: row.try_get("due_date")?,
        order: row.try_get("sort_order")?,
        assignee_ids: ids(row, "user_ids")?,
        label_ids: ids(row, "label_ids")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        completed_at: row.try_get("completed_at")?,
        created_by: row.try_get("created_by")?,
        parent_id: row.try_get("parent_id")?,
        blocked_by_ids: ids(row, "task_ids")?,
    }))
}

fn read_all(rows: &[PgRow]) -> sqlx::Result<Vec<TaskRecord>> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.extend(read_task(row)?);
    }
    Ok(out)
}

pub(crate) fn to_proto(t: &TaskRecord) -> pb::Task {
    pb::Task {
        id: t.pid.to_string(),
        module_id: t.module_id.clone(),
        title: t.title.clone(),
        description: t.description.clone(),
        status: t.status.to_proto(),
        priority: t.priority.to_proto(),
        start_date: t.start_date.clone(),
        due_date: t.due_date.clone(),
        order: t.order,
        assignee_ids: t.assignee_ids.clone(),
        label_ids: t.label_ids.clone(),
        created_at: t.created_at.clone(),
        updated_at: t.updated_at.clone(),
        completed_at: t.completed_at.clone(),
        created_by: t.created_by.clone(),
        parent_id: t.parent_id.clone(),
        blocked_by_ids: t.blocked_by_ids.clone(),
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_task(store: &Store, pid: i64) -> anyhow::Result<Option<TaskRecord>> {
    let row = sqlx::query(&format!("{SELECT_TASK} WHERE i.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_task(&row)?,
        None => None,
    })
}

/// Every task (for cross-project aggregation), oldest first.
pub(crate) async fn load_all_tasks(store: &Store) -> anyhow::Result<Vec<TaskRecord>> {
    let rows = sqlx::query(&format!("{SELECT_TASK} ORDER BY i.pid"))
        .fetch_all(store.pool())
        .await?;
    Ok(read_all(&rows)?)
}

/// Task entity `pid`s in a module, subtasks included.
pub(crate) async fn task_pids_for_module(
    store: &Store,
    module_id: &str,
) -> anyhow::Result<Vec<i64>> {
    Ok(sqlx::query_scalar(
        "SELECT m.pid FROM cmp_taskmoduleref m JOIN cmp_taskinfo i ON i.pid = m.pid \
         WHERE m.module_id = $1 ORDER BY m.pid",
    )
    .bind(module_id)
    .fetch_all(store.pool())
    .await?)
}

/// Tasks whose module is one of `module_ids`, sorted by (order, pid).
pub(crate) async fn tasks_for_modules(
    store: &Store,
    module_ids: HashSet<String>,
) -> anyhow::Result<Vec<TaskRecord>> {
    let module_ids: Vec<String> = module_ids.into_iter().collect();
    let rows = sqlx::query(&format!(
        "{SELECT_TASK} WHERE m.module_id = ANY($1) ORDER BY i.sort_order, i.pid"
    ))
    .bind(module_ids)
    .fetch_all(store.pool())
    .await?;
    Ok(read_all(&rows)?)
}

/// Subtask `pid`s of a parent.
pub(crate) async fn subtask_pids(store: &Store, parent_id: &str) -> anyhow::Result<Vec<i64>> {
    Ok(
        sqlx::query_scalar("SELECT pid FROM cmp_taskparent WHERE parent_id = $1 ORDER BY pid")
            .bind(parent_id)
            .fetch_all(store.pool())
            .await?,
    )
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// The fields a create or an update writes. Order is not here: a create
/// appends and an update keeps it; `move_task` is what changes it.
pub(crate) struct TaskFields {
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub assignee_ids: Vec<String>,
    pub label_ids: Vec<String>,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

async fn upsert_ids(
    conn: &mut PgConnection,
    table: &str,
    col: &str,
    pid: i64,
    ids: Vec<String>,
) -> sqlx::Result<()> {
    sqlx::query(&format!(
        "INSERT INTO {table} (pid, {col}) VALUES ($1, to_jsonb($2::text[])) \
         ON CONFLICT (pid) DO UPDATE SET {col} = EXCLUDED.{col}"
    ))
    .bind(pid)
    .bind(ids)
    .execute(conn)
    .await?;
    Ok(())
}

/// Create a task at the end of `module_id`'s order, as a subtask of `parent_id`
/// when given. Returns its `pid`.
pub(crate) async fn create_task(
    store: &Store,
    module_id: &str,
    parent_id: Option<&str>,
    created_by: &str,
    f: TaskFields,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let order: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(i.sort_order) + 1, 0) FROM cmp_taskinfo i \
         JOIN cmp_taskmoduleref m ON m.pid = i.pid WHERE m.module_id = $1",
    )
    .bind(module_id)
    .fetch_one(&mut *tx)
    .await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_taskinfo (pid, title, description, status, priority, start_date, due_date, sort_order) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::int4)",
    )
    .bind(pid)
    .bind(&f.title)
    .bind(&f.description)
    .bind(f.status.as_str())
    .bind(f.priority.as_str())
    .bind(&f.start_date)
    .bind(&f.due_date)
    .bind(order)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO cmp_taskmoduleref (pid, module_id) VALUES ($1, $2)")
        .bind(pid)
        .bind(module_id)
        .execute(&mut *tx)
        .await?;
    upsert_ids(&mut tx, "cmp_taskassignees", "user_ids", pid, f.assignee_ids).await?;
    upsert_ids(&mut tx, "cmp_tasklabels", "label_ids", pid, f.label_ids).await?;
    sqlx::query(
        "INSERT INTO cmp_taskaudit (pid, created_at, updated_at, completed_at, created_by) \
         VALUES ($1, $2, $2, $3, $4)",
    )
    .bind(pid)
    .bind(&f.updated_at)
    .bind(&f.completed_at)
    .bind(created_by)
    .execute(&mut *tx)
    .await?;
    if let Some(p) = parent_id {
        sqlx::query("INSERT INTO cmp_taskparent (pid, parent_id) VALUES ($1, $2)")
            .bind(pid)
            .bind(p)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(pid)
}

/// Overwrite a task's fields and dependencies. `parent`: `None` leaves the
/// parent alone, `Some(None)` detaches, `Some(Some(id))` sets.
pub(crate) async fn update_task(
    store: &Store,
    pid: i64,
    f: TaskFields,
    blocked_by: Vec<String>,
    parent: Option<Option<String>>,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    sqlx::query(
        "UPDATE cmp_taskinfo SET title = $2, description = $3, status = $4, priority = $5, \
         start_date = $6, due_date = $7 WHERE pid = $1",
    )
    .bind(pid)
    .bind(&f.title)
    .bind(&f.description)
    .bind(f.status.as_str())
    .bind(f.priority.as_str())
    .bind(&f.start_date)
    .bind(&f.due_date)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE cmp_taskaudit SET updated_at = $2, completed_at = $3 WHERE pid = $1")
        .bind(pid)
        .bind(&f.updated_at)
        .bind(&f.completed_at)
        .execute(&mut *tx)
        .await?;
    upsert_ids(&mut tx, "cmp_taskassignees", "user_ids", pid, f.assignee_ids).await?;
    upsert_ids(&mut tx, "cmp_tasklabels", "label_ids", pid, f.label_ids).await?;
    upsert_ids(&mut tx, "cmp_taskblockedby", "task_ids", pid, blocked_by).await?;
    match parent {
        None => {}
        Some(None) => {
            sqlx::query("DELETE FROM cmp_taskparent WHERE pid = $1")
                .bind(pid)
                .execute(&mut *tx)
                .await?;
        }
        Some(Some(p)) => {
            sqlx::query(
                "INSERT INTO cmp_taskparent (pid, parent_id) VALUES ($1, $2) \
                 ON CONFLICT (pid) DO UPDATE SET parent_id = EXCLUDED.parent_id",
            )
            .bind(pid)
            .bind(p)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Put a task at `order` in `module_id`, and carry its subtasks to the same
/// module — a subtask always lives in its parent's module.
pub(crate) async fn move_task(
    store: &Store,
    pid: i64,
    module_id: &str,
    order: i32,
    updated_at: &str,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    sqlx::query("UPDATE cmp_taskinfo SET sort_order = $2::int4 WHERE pid = $1")
        .bind(pid)
        .bind(order)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE cmp_taskaudit SET updated_at = $2 WHERE pid = $1")
        .bind(pid)
        .bind(updated_at)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE cmp_taskmoduleref SET module_id = $2 \
         WHERE pid = $1 OR pid IN (SELECT pid FROM cmp_taskparent WHERE parent_id = $3)",
    )
    .bind(pid)
    .bind(module_id)
    .bind(pid.to_string())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE arke_entities SET version = version + 1 \
         WHERE pid IN (SELECT pid FROM cmp_taskparent WHERE parent_id = $1)",
    )
    .bind(pid.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Delete a task and its subtasks. Returns the subtask pids, for the caller to
/// take out of the search index and the dependency lists.
pub(crate) async fn delete_task(store: &Store, pid: i64) -> anyhow::Result<Vec<i64>> {
    let mut tx = store.pool().begin().await?;
    let subtasks: Vec<i64> = sqlx::query_scalar(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_taskparent WHERE parent_id = $1) RETURNING pid",
    )
    .bind(pid.to_string())
    .fetch_all(&mut *tx)
    .await?;
    entity::delete(&mut tx, pid).await?;
    tx.commit().await?;
    Ok(subtasks)
}

/// Remove every id in `gone_ids` from the `blocked_by` list of each task in
/// `module_ids` that lists one, keeping the rest in order.
pub(crate) async fn strip_blocked_by(
    store: &Store,
    module_ids: &[String],
    gone_ids: &[String],
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    let changed: Vec<i64> = sqlx::query_scalar(
        "UPDATE cmp_taskblockedby b SET task_ids = COALESCE( \
             (SELECT jsonb_agg(e.x ORDER BY e.n) \
              FROM jsonb_array_elements_text(b.task_ids) WITH ORDINALITY AS e(x, n) \
              WHERE e.x <> ALL($2)), '[]'::jsonb) \
         WHERE b.task_ids ?| $2 \
           AND b.pid IN (SELECT pid FROM cmp_taskmoduleref WHERE module_id = ANY($1)) \
         RETURNING b.pid",
    )
    .bind(module_ids)
    .bind(gone_ids)
    .fetch_all(&mut *tx)
    .await?;
    for pid in changed {
        entity::touch(&mut tx, pid).await?;
    }
    tx.commit().await?;
    Ok(())
}
