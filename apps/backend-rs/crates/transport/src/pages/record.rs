//! Page rows ↔ proto, plus every read and write the page flows make.
//!
//! Plain sqlx over the component tables of `persistence/src/schema.sql` (see
//! `persistence::entity`). A page is one entity carrying `cmp_pageinfo` and
//! `cmp_pageaudit`.

use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::page::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct PageRecord {
    pub pid: i64,
    pub project_id: String,
    pub title: String,
    pub icon: String,
    pub content: String,
    pub order: i32,
    pub created_by: String,
    pub last_edited_by: String,
    pub created_at: String,
    pub updated_at: String,
}

const SELECT_PAGE: &str = "\
    SELECT i.pid, i.project_id, i.title, i.icon, i.content, i.sort_order, \
           a.created_by, a.last_edited_by, a.created_at, a.updated_at \
    FROM cmp_pageinfo i JOIN cmp_pageaudit a ON a.pid = i.pid";

fn read_page(row: &PgRow) -> sqlx::Result<PageRecord> {
    Ok(PageRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        title: row.try_get("title")?,
        icon: row.try_get("icon")?,
        content: row.try_get("content")?,
        order: row.try_get("sort_order")?,
        created_by: row.try_get("created_by")?,
        last_edited_by: row.try_get("last_edited_by")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn to_proto(p: &PageRecord) -> pb::Page {
    pb::Page {
        id: p.pid.to_string(),
        project_id: p.project_id.clone(),
        title: p.title.clone(),
        icon: p.icon.clone(),
        content: p.content.clone(),
        order: p.order,
        created_by: p.created_by.clone(),
        last_edited_by: p.last_edited_by.clone(),
        created_at: p.created_at.clone(),
        updated_at: p.updated_at.clone(),
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_page(store: &Store, pid: i64) -> anyhow::Result<Option<PageRecord>> {
    let row = sqlx::query(&format!("{SELECT_PAGE} WHERE i.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_page).transpose()?)
}

/// Pages of a project, sorted by (order, pid).
pub(crate) async fn pages_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<PageRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_PAGE} WHERE i.project_id = $1 ORDER BY i.sort_order, i.pid"
    ))
    .bind(project_id)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read_page).collect::<sqlx::Result<_>>()?)
}

/// How many pages a project has — a COUNT, no bodies loaded.
pub(crate) async fn page_count_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<u32> {
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_pageinfo WHERE project_id = $1")
        .bind(project_id)
        .fetch_one(store.pool())
        .await?;
    Ok(n.max(0) as u32)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Append a page to the end of the project's order. Returns its `pid`.
pub(crate) async fn create_page(
    store: &Store,
    project_id: &str,
    title: &str,
    icon: &str,
    content: &str,
    author: &str,
    now: &str,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let order: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(i.sort_order) + 1, 0) FROM cmp_pageinfo i \
         JOIN cmp_pageaudit a ON a.pid = i.pid WHERE i.project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&mut *tx)
    .await?;
    let pid = entity::new_pid(&mut tx).await?;
    // `$6::int4`: see `persistence::entity` on integer parameters.
    sqlx::query(
        "INSERT INTO cmp_pageinfo (pid, project_id, title, icon, content, sort_order) \
         VALUES ($1, $2, $3, $4, $5, $6::int4)",
    )
    .bind(pid)
    .bind(project_id)
    .bind(title)
    .bind(icon)
    .bind(content)
    .bind(order)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO cmp_pageaudit (pid, created_by, last_edited_by, created_at, updated_at) \
         VALUES ($1, $2, $2, $3, $3)",
    )
    .bind(pid)
    .bind(author)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

pub(crate) async fn update_page(
    store: &Store,
    pid: i64,
    title: &str,
    icon: &str,
    content: &str,
    editor: &str,
    now: &str,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    sqlx::query("UPDATE cmp_pageinfo SET title = $2, icon = $3, content = $4 WHERE pid = $1")
        .bind(pid)
        .bind(title)
        .bind(icon)
        .bind(content)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE cmp_pageaudit SET last_edited_by = $2, updated_at = $3 WHERE pid = $1")
        .bind(pid)
        .bind(editor)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Give each listed page its position in `page_ids` as its order. Ids that are
/// malformed or name a page of another project are skipped.
pub(crate) async fn reorder_pages(
    store: &Store,
    project_id: &str,
    page_ids: &[String],
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    for (idx, id) in page_ids.iter().enumerate() {
        let Ok(ppid) = id.parse::<i64>() else {
            continue;
        };
        let updated = sqlx::query(
            "UPDATE cmp_pageinfo SET sort_order = $2::int4 WHERE pid = $1 AND project_id = $3 \
             AND EXISTS (SELECT 1 FROM cmp_pageaudit a WHERE a.pid = $1)",
        )
        .bind(ppid)
        .bind(idx as i32)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() > 0 {
            entity::touch(&mut tx, ppid).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn delete_page(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}
