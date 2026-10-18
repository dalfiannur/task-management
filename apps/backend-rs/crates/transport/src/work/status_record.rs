//! Task-status rows ↔ proto, plus every read and write the status flows make.
//!
//! A status is one entity carrying `cmp_taskstatusdef`. A task points at one
//! through `cmp_taskstatusref`; `cmp_taskinfo.status` mirrors that status's
//! category so category readers (reports, dashboard) never join here. Every
//! write that changes a status's category, or moves tasks off a status, keeps
//! that mirror in step inside the same transaction.

use domain::task::{TaskStatus, DEFAULT_STATUSES};
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};

use crate::sedjiwa::tasks::work::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct StatusRecord {
    pub pid: i64,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub category: TaskStatus,
    pub order: i32,
}

const SELECT_STATUS: &str =
    "SELECT pid, project_id, name, color, category, sort_order FROM cmp_taskstatusdef";

/// `None` for a category this build does not know, which drops the row.
fn read_status(row: &PgRow) -> sqlx::Result<Option<StatusRecord>> {
    let category: String = row.try_get("category")?;
    let Some(category) = TaskStatus::parse(&category) else {
        return Ok(None);
    };
    Ok(Some(StatusRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        color: row.try_get("color")?,
        category,
        order: row.try_get("sort_order")?,
    }))
}

pub(crate) fn to_proto(s: &StatusRecord) -> pb::TaskStatusDef {
    pb::TaskStatusDef {
        id: s.pid.to_string(),
        project_id: s.project_id.clone(),
        name: s.name.clone(),
        color: s.color.clone(),
        category: s.category.to_proto(),
        order: s.order,
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_status(store: &Store, pid: i64) -> anyhow::Result<Option<StatusRecord>> {
    let row = sqlx::query(&format!("{SELECT_STATUS} WHERE pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_status(&row)?,
        None => None,
    })
}

/// A project's statuses in workflow order, creating the defaults first when
/// it has none (projects written by fixtures or seeds skip `create_project`).
pub(crate) async fn statuses_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<StatusRecord>> {
    let mut tx = store.pool().begin().await?;
    ensure_defaults(&mut tx, project_id).await?;
    let rows = sqlx::query(&format!(
        "{SELECT_STATUS} WHERE project_id = $1 ORDER BY sort_order, pid"
    ))
    .bind(project_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.extend(read_status(row)?);
    }
    Ok(out)
}

/// Number of tasks currently on `status_id` (explicitly, or by falling back to
/// it as the first status of their category).
pub(crate) async fn task_count(store: &Store, s: &StatusRecord) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT count(*) FROM ({}) t",
        tasks_on_status_sql()
    ))
    .bind(&s.project_id)
    .bind(s.pid.to_string())
    .fetch_one(store.pool())
    .await?)
}

/// Task pids on status `$2` in project `$1`: those pointing at it, plus those
/// with no (or a dangling) pointer whose category falls back to it.
fn tasks_on_status_sql() -> &'static str {
    "SELECT i.pid FROM cmp_taskinfo i \
     JOIN cmp_taskmoduleref m ON m.pid = i.pid \
     JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = $1 \
     LEFT JOIN cmp_taskstatusref sr ON sr.pid = i.pid \
     WHERE COALESCE( \
         (SELECT d.pid::text FROM cmp_taskstatusdef d \
          WHERE d.project_id = $1 AND d.pid::text = sr.status_id), \
         (SELECT d.pid::text FROM cmp_taskstatusdef d \
          WHERE d.project_id = $1 AND d.category = i.status \
          ORDER BY d.sort_order, d.pid LIMIT 1) \
     ) = $2"
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Insert the default statuses for `project_id` unless it already has some.
/// Serialised per project so two first reads cannot both insert.
pub(crate) async fn ensure_defaults(conn: &mut PgConnection, project_id: &str) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('cmp_taskstatusdef:' || $1))")
        .bind(project_id)
        .execute(&mut *conn)
        .await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM cmp_taskstatusdef WHERE project_id = $1)",
    )
    .bind(project_id)
    .fetch_one(&mut *conn)
    .await?;
    if exists {
        return Ok(());
    }
    for (i, (name, color, category)) in DEFAULT_STATUSES.iter().enumerate() {
        insert_status(conn, project_id, name, color, *category, i as i32).await?;
    }
    Ok(())
}

async fn insert_status(
    conn: &mut PgConnection,
    project_id: &str,
    name: &str,
    color: &str,
    category: TaskStatus,
    order: i32,
) -> sqlx::Result<i64> {
    let pid = entity::new_pid(conn).await?;
    sqlx::query(
        "INSERT INTO cmp_taskstatusdef (pid, project_id, name, color, category, sort_order) \
         VALUES ($1, $2, $3, $4, $5, $6::int4)",
    )
    .bind(pid)
    .bind(project_id)
    .bind(name)
    .bind(color)
    .bind(category.as_str())
    .bind(order)
    .execute(conn)
    .await?;
    Ok(pid)
}

/// Append a status at the end of the project's workflow. Returns its `pid`.
pub(crate) async fn create_status(
    store: &Store,
    project_id: &str,
    name: &str,
    color: &str,
    category: TaskStatus,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    ensure_defaults(&mut tx, project_id).await?;
    let order: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM cmp_taskstatusdef WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&mut *tx)
    .await?;
    let pid = insert_status(&mut tx, project_id, name, color, category, order).await?;
    tx.commit().await?;
    Ok(pid)
}

/// Set the fields that are `Some`. A category change is mirrored onto every
/// task on this status, with `completed_at` following the Done rule.
pub(crate) async fn update_status(
    store: &Store,
    s: &StatusRecord,
    name: Option<String>,
    color: Option<String>,
    category: Option<TaskStatus>,
    now: &str,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, s.pid).await? {
        return Ok(());
    }
    let category = category.filter(|c| *c != s.category);
    // Pin every task resolved to this status by fallback before the category
    // moves, or they would fall back to a different status afterwards.
    let tasks = match category {
        Some(_) => pin_tasks(&mut tx, s).await?,
        None => Vec::new(),
    };
    sqlx::query(
        "UPDATE cmp_taskstatusdef SET name = COALESCE($2, name), color = COALESCE($3, color), \
         category = COALESCE($4, category) WHERE pid = $1",
    )
    .bind(s.pid)
    .bind(name)
    .bind(color)
    .bind(category.map(|c| c.as_str()))
    .execute(&mut *tx)
    .await?;
    if let Some(c) = category {
        set_category(&mut tx, &tasks, c, now).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Move every task on `s` to `replacement` (when given), then delete `s`.
pub(crate) async fn delete_status(
    store: &Store,
    s: &StatusRecord,
    replacement: Option<&StatusRecord>,
    now: &str,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    let tasks = pin_tasks(&mut tx, s).await?;
    if let Some(r) = replacement {
        sqlx::query("UPDATE cmp_taskstatusref SET status_id = $2 WHERE pid = ANY($1)")
            .bind(&tasks)
            .bind(r.pid.to_string())
            .execute(&mut *tx)
            .await?;
        if r.category != s.category {
            set_category(&mut tx, &tasks, r.category, now).await?;
        }
    }
    entity::delete(&mut tx, s.pid).await?;
    tx.commit().await?;
    Ok(())
}

/// Rewrite `sort_order` to follow `ids` (already validated as the project's
/// full set).
pub(crate) async fn reorder_statuses(store: &Store, ids: &[i64]) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    for (i, pid) in ids.iter().enumerate() {
        if entity::touch(&mut tx, *pid).await? {
            sqlx::query("UPDATE cmp_taskstatusdef SET sort_order = $2::int4 WHERE pid = $1")
                .bind(pid)
                .bind(i as i32)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Give every task on `s` an explicit pointer to it, returning their pids.
async fn pin_tasks(conn: &mut PgConnection, s: &StatusRecord) -> sqlx::Result<Vec<i64>> {
    let tasks: Vec<i64> = sqlx::query_scalar(tasks_on_status_sql())
        .bind(&s.project_id)
        .bind(s.pid.to_string())
        .fetch_all(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO cmp_taskstatusref (pid, status_id) SELECT unnest($1::int8[]), $2 \
         ON CONFLICT (pid) DO UPDATE SET status_id = EXCLUDED.status_id",
    )
    .bind(&tasks)
    .bind(s.pid.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(tasks)
}

/// Mirror `category` onto `tasks`: entering Done stamps `completed_at`,
/// leaving it clears it.
async fn set_category(
    conn: &mut PgConnection,
    tasks: &[i64],
    category: TaskStatus,
    now: &str,
) -> sqlx::Result<()> {
    if tasks.is_empty() {
        return Ok(());
    }
    sqlx::query("UPDATE cmp_taskinfo SET status = $2 WHERE pid = ANY($1)")
        .bind(tasks)
        .bind(category.as_str())
        .execute(&mut *conn)
        .await?;
    let completed = (category == TaskStatus::Done).then_some(now);
    sqlx::query(
        "UPDATE cmp_taskaudit SET updated_at = $2, completed_at = $3 WHERE pid = ANY($1)",
    )
    .bind(tasks)
    .bind(now)
    .bind(completed)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE arke_entities SET version = version + 1 WHERE pid = ANY($1)")
        .bind(tasks)
        .execute(&mut *conn)
        .await?;
    Ok(())
}
