//! Media and task↔media link rows ↔ proto, plus every read and write the
//! media flows make.
//!
//! Plain sqlx over the component tables of `persistence/src/schema.sql` (see
//! `persistence::entity`). A file is one entity with a `cmp_mediafileinfo`
//! row; a link is its own entity with a `cmp_taskmedialinkdata` row.

use domain::media::MediaStatus;
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::media::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct MediaRecord {
    pub pid: i64,
    pub project_id: String,
    pub file_name: String,
    pub original_file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub storage_key: String,
    pub uploaded_by: String,
    pub created_at: String,
    pub status: MediaStatus,
}

const SELECT_MEDIA: &str = "\
    SELECT pid, project_id, file_name, original_file_name, mime_type, size, storage_key, \
           uploaded_by, created_at, status \
    FROM cmp_mediafileinfo";

/// `None` for a stored status this build does not know.
fn read_media(row: &PgRow) -> sqlx::Result<Option<MediaRecord>> {
    let status: String = row.try_get("status")?;
    let Some(status) = MediaStatus::parse(&status) else {
        return Ok(None);
    };
    Ok(Some(MediaRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        file_name: row.try_get("file_name")?,
        original_file_name: row.try_get("original_file_name")?,
        mime_type: row.try_get("mime_type")?,
        size: row.try_get("size")?,
        storage_key: row.try_get("storage_key")?,
        uploaded_by: row.try_get("uploaded_by")?,
        created_at: row.try_get("created_at")?,
        status,
    }))
}

pub(crate) fn to_proto(m: &MediaRecord) -> pb::MediaFile {
    pb::MediaFile {
        id: m.pid.to_string(),
        project_id: m.project_id.clone(),
        file_name: m.file_name.clone(),
        original_file_name: m.original_file_name.clone(),
        mime_type: m.mime_type.clone(),
        size: m.size,
        uploaded_by: m.uploaded_by.clone(),
        created_at: m.created_at.clone(),
        status: m.status.to_proto(),
    }
}

// ── Files ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_media(store: &Store, pid: i64) -> anyhow::Result<Option<MediaRecord>> {
    let row = sqlx::query(&format!("{SELECT_MEDIA} WHERE pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_media(&row)?,
        None => None,
    })
}

/// Ready files of a project, newest first (by created_at byte-wise, then pid).
pub(crate) async fn ready_media_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<MediaRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_MEDIA} WHERE project_id = $1 AND status = $2 \
         ORDER BY created_at COLLATE \"C\" DESC, pid DESC"
    ))
    .bind(project_id)
    .bind(MediaStatus::Ready.as_str())
    .fetch_all(store.pool())
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.extend(read_media(row)?);
    }
    Ok(out)
}

/// How many *ready* files a project has — a COUNT, no rows loaded.
pub(crate) async fn ready_media_count_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<u32> {
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM cmp_mediafileinfo WHERE project_id = $1 AND status = $2",
    )
    .bind(project_id)
    .bind(MediaStatus::Ready.as_str())
    .fetch_one(store.pool())
    .await?;
    Ok(n.max(0) as u32)
}

pub(crate) struct NewMedia<'a> {
    pub project_id: &'a str,
    pub file_name: &'a str,
    pub mime_type: &'a str,
    pub size: i64,
    pub storage_key: &'a str,
    pub uploaded_by: &'a str,
    pub created_at: &'a str,
}

/// A Pending file row; `original_file_name` starts as the file name.
pub(crate) async fn create_media(store: &Store, m: NewMedia<'_>) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    // `$5::int8`: see `persistence::entity` on integer parameters.
    sqlx::query(
        "INSERT INTO cmp_mediafileinfo (pid, project_id, file_name, original_file_name, mime_type, \
         size, storage_key, uploaded_by, created_at, status) \
         VALUES ($1, $2, $3, $3, $4, $5::int8, $6, $7, $8, $9)",
    )
    .bind(pid)
    .bind(m.project_id)
    .bind(m.file_name)
    .bind(m.mime_type)
    .bind(m.size)
    .bind(m.storage_key)
    .bind(m.uploaded_by)
    .bind(m.created_at)
    .bind(MediaStatus::Pending.as_str())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

/// Mark a file Ready with the size storage reported.
pub(crate) async fn mark_ready(store: &Store, pid: i64, size: i64) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query("UPDATE cmp_mediafileinfo SET status = $2, size = $3::int8 WHERE pid = $1")
            .bind(pid)
            .bind(MediaStatus::Ready.as_str())
            .bind(size)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    Ok(())
}

/// Delete a file and every link to it.
pub(crate) async fn delete_media(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_taskmedialinkdata WHERE media_file_id = $1)",
    )
    .bind(pid.to_string())
    .execute(&mut *tx)
    .await?;
    entity::delete(&mut tx, pid).await?;
    tx.commit().await?;
    Ok(())
}

// ── Task↔media links ─────────────────────────────────────────────────────────

/// Link a file to a task unless the link exists.
pub(crate) async fn link(
    store: &Store,
    task_id: &str,
    media_file_id: &str,
    project_id: &str,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM cmp_taskmedialinkdata WHERE task_id = $1 AND media_file_id = $2)",
    )
    .bind(task_id)
    .bind(media_file_id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        let pid = entity::new_pid(&mut tx).await?;
        sqlx::query(
            "INSERT INTO cmp_taskmedialinkdata (pid, media_file_id, task_id, project_id) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(pid)
        .bind(media_file_id)
        .bind(task_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Remove every link between a task and a file.
pub(crate) async fn unlink(store: &Store, task_id: &str, media_file_id: &str) -> anyhow::Result<()> {
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_taskmedialinkdata WHERE task_id = $1 AND media_file_id = $2)",
    )
    .bind(task_id)
    .bind(media_file_id)
    .execute(store.pool())
    .await?;
    Ok(())
}

/// Media file ids linked to `task_id`, in link order.
pub(crate) async fn media_ids_for_task(
    store: &Store,
    task_id: &str,
) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT media_file_id FROM cmp_taskmedialinkdata WHERE task_id = $1 ORDER BY pid",
    )
    .bind(task_id)
    .fetch_all(store.pool())
    .await?)
}
