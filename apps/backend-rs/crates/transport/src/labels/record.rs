//! Label rows ↔ proto, plus every read and write the label flows make.
//!
//! Plain sqlx over `cmp_labelinfo` (see `persistence::entity`). A label is one
//! entity with one row.

use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::label::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct LabelRecord {
    pub pid: i64,
    pub project_id: String,
    pub name: String,
    pub color: String,
}

fn read_label(row: &PgRow) -> sqlx::Result<LabelRecord> {
    Ok(LabelRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        color: row.try_get("color")?,
    })
}

pub(crate) fn to_proto(l: &LabelRecord) -> pb::Label {
    pb::Label {
        id: l.pid.to_string(),
        project_id: l.project_id.clone(),
        name: l.name.clone(),
        color: l.color.clone(),
    }
}

pub(crate) async fn load_label(store: &Store, pid: i64) -> anyhow::Result<Option<LabelRecord>> {
    let row = sqlx::query("SELECT pid, project_id, name, color FROM cmp_labelinfo WHERE pid = $1")
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_label).transpose()?)
}

/// Labels of a project, sorted by (name, pid) — byte-wise, as Rust sorted them.
pub(crate) async fn labels_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<LabelRecord>> {
    let rows = sqlx::query(
        "SELECT pid, project_id, name, color FROM cmp_labelinfo WHERE project_id = $1 \
         ORDER BY name COLLATE \"C\", pid",
    )
    .bind(project_id)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read_label).collect::<sqlx::Result<_>>()?)
}

pub(crate) async fn create_label(
    store: &Store,
    project_id: &str,
    name: &str,
    color: &str,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query("INSERT INTO cmp_labelinfo (pid, project_id, name, color) VALUES ($1, $2, $3, $4)")
        .bind(pid)
        .bind(project_id)
        .bind(name)
        .bind(color)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(pid)
}

/// Set the fields that are `Some`; leave the rest.
pub(crate) async fn update_label(
    store: &Store,
    pid: i64,
    name: Option<String>,
    color: Option<String>,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query(
            "UPDATE cmp_labelinfo SET name = COALESCE($2, name), color = COALESCE($3, color) \
             WHERE pid = $1",
        )
        .bind(pid)
        .bind(name)
        .bind(color)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

/// Tolerant delete: only the label; tasks keep dangling `label_ids`.
pub(crate) async fn delete_label(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}
