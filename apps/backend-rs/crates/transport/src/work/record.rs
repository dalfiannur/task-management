//! Module rows ↔ proto, plus every read and write the module flows make.
//!
//! Plain sqlx over the component tables arke-postgres created (see
//! `persistence::entity`). A module is one entity carrying `cmp_modulename`,
//! `cmp_moduleprojectref` and `cmp_moduleorder`, optionally
//! `cmp_moduledescription`.

use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::work::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct ModuleRecord {
    pub pid: i64,
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
    pub order: i32,
}

/// Name, project and order are what make an entity a module.
const SELECT_MODULE: &str = "\
    SELECT n.pid, n.value AS name, d.value AS description, p.project_id, o.value AS sort_order \
    FROM cmp_modulename n \
    JOIN cmp_moduleprojectref p ON p.pid = n.pid \
    JOIN cmp_moduleorder o ON o.pid = n.pid \
    LEFT JOIN cmp_moduledescription d ON d.pid = n.pid";

fn read_module(row: &PgRow) -> sqlx::Result<ModuleRecord> {
    Ok(ModuleRecord {
        pid: row.try_get("pid")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        project_id: row.try_get("project_id")?,
        order: row.try_get("sort_order")?,
    })
}

pub(crate) fn to_proto(m: &ModuleRecord) -> pb::Module {
    pb::Module {
        id: m.pid.to_string(),
        name: m.name.clone(),
        description: m.description.clone(),
        order: m.order,
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_module(store: &Store, pid: i64) -> anyhow::Result<Option<ModuleRecord>> {
    let row = sqlx::query(&format!("{SELECT_MODULE} WHERE n.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_module).transpose()?)
}

/// Every module (for cross-project aggregation), oldest first.
pub(crate) async fn load_all_modules(store: &Store) -> anyhow::Result<Vec<ModuleRecord>> {
    let rows = sqlx::query(&format!("{SELECT_MODULE} ORDER BY n.pid"))
        .fetch_all(store.pool())
        .await?;
    Ok(rows.iter().map(read_module).collect::<sqlx::Result<_>>()?)
}

/// Modules of a project, sorted by order then pid.
pub(crate) async fn modules_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<ModuleRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_MODULE} WHERE p.project_id = $1 ORDER BY o.value, n.pid"
    ))
    .bind(project_id)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read_module).collect::<sqlx::Result<_>>()?)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Append a module to the end of a project's order. Returns its `pid`.
pub(crate) async fn create_module(
    store: &Store,
    project_id: &str,
    name: &str,
    description: Option<&str>,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let next_order: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(o.value) + 1, 0) FROM cmp_moduleorder o \
         JOIN cmp_moduleprojectref p ON p.pid = o.pid \
         JOIN cmp_modulename n ON n.pid = o.pid \
         WHERE p.project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&mut *tx)
    .await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query("INSERT INTO cmp_modulename (pid, value) VALUES ($1, $2)")
        .bind(pid)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_moduleprojectref (pid, project_id) VALUES ($1, $2)")
        .bind(pid)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_moduleorder (pid, value) VALUES ($1, $2::int4)")
        .bind(pid)
        .bind(next_order)
        .execute(&mut *tx)
        .await?;
    if let Some(desc) = description {
        sqlx::query("INSERT INTO cmp_moduledescription (pid, value) VALUES ($1, $2)")
            .bind(pid)
            .bind(desc)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(pid)
}

/// Rename and/or re-describe. `None` leaves a field alone; an empty
/// description removes it.
pub(crate) async fn update_module(
    store: &Store,
    pid: i64,
    name: Option<String>,
    description: Option<String>,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    if let Some(n) = name {
        sqlx::query(
            "INSERT INTO cmp_modulename (pid, value) VALUES ($1, $2) \
             ON CONFLICT (pid) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(pid)
        .bind(n)
        .execute(&mut *tx)
        .await?;
    }
    match description {
        None => {}
        Some(d) if d.is_empty() => {
            sqlx::query("DELETE FROM cmp_moduledescription WHERE pid = $1")
                .bind(pid)
                .execute(&mut *tx)
                .await?;
        }
        Some(d) => {
            sqlx::query(
                "INSERT INTO cmp_moduledescription (pid, value) VALUES ($1, $2) \
                 ON CONFLICT (pid) DO UPDATE SET value = EXCLUDED.value",
            )
            .bind(pid)
            .bind(d)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Give each listed module its position in `module_ids` as its order. Ids
/// that are malformed or name a module of another project are skipped.
pub(crate) async fn reorder_modules(
    store: &Store,
    project_id: &str,
    module_ids: &[String],
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    for (idx, mid) in module_ids.iter().enumerate() {
        let Ok(mpid) = mid.parse::<i64>() else {
            continue;
        };
        let updated = sqlx::query(
            "UPDATE cmp_moduleorder SET value = $2::int4 WHERE pid = $1 AND EXISTS \
             (SELECT 1 FROM cmp_moduleprojectref p JOIN cmp_modulename n ON n.pid = p.pid \
              WHERE p.pid = $1 AND p.project_id = $3)",
        )
        .bind(mpid)
        .bind(idx as i32)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() > 0 {
            entity::touch(&mut tx, mpid).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Delete a module and every task in it (subtasks live in their parent's
/// module, so they are among them). Returns the deleted task pids, for the
/// caller to take out of the search index.
pub(crate) async fn delete_module(store: &Store, pid: i64) -> anyhow::Result<Vec<i64>> {
    let mut tx = store.pool().begin().await?;
    let task_pids: Vec<i64> = sqlx::query_scalar(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT m.pid FROM cmp_taskmoduleref m JOIN cmp_taskinfo i ON i.pid = m.pid \
          WHERE m.module_id = $1) \
         RETURNING pid",
    )
    .bind(pid.to_string())
    .fetch_all(&mut *tx)
    .await?;
    entity::delete(&mut tx, pid).await?;
    tx.commit().await?;
    Ok(task_pids)
}
