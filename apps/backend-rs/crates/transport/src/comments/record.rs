//! Comment rows ↔ proto, plus every read and write the comment flows make.
//!
//! Plain sqlx over `cmp_commentinfo` (see `persistence::entity`). A comment is
//! one entity with one row; `mentioned_user_ids` is a JSONB string array,
//! read as `text[]` and written with `to_jsonb`, as in `work::task_record`.

use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::comment::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct CommentRecord {
    pub pid: i64,
    pub task_id: String,
    pub author_id: String,
    pub content: String,
    pub mentioned_user_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

const SELECT_COMMENT: &str = "\
    SELECT pid, task_id, author_id, content, created_at, updated_at, \
           ARRAY(SELECT e.x FROM jsonb_array_elements_text(mentioned_user_ids) \
                 WITH ORDINALITY AS e(x, n) ORDER BY e.n) AS mentioned_user_ids \
    FROM cmp_commentinfo";

fn read_comment(row: &PgRow) -> sqlx::Result<CommentRecord> {
    Ok(CommentRecord {
        pid: row.try_get("pid")?,
        task_id: row.try_get("task_id")?,
        author_id: row.try_get("author_id")?,
        content: row.try_get("content")?,
        mentioned_user_ids: row.try_get("mentioned_user_ids")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn to_proto(c: &CommentRecord) -> pb::Comment {
    pb::Comment {
        id: c.pid.to_string(),
        task_id: c.task_id.clone(),
        author_id: c.author_id.clone(),
        content: c.content.clone(),
        mentioned_user_ids: c.mentioned_user_ids.clone(),
        created_at: c.created_at.clone(),
        updated_at: c.updated_at.clone(),
    }
}

pub(crate) async fn load_comment(store: &Store, pid: i64) -> anyhow::Result<Option<CommentRecord>> {
    let row = sqlx::query(&format!("{SELECT_COMMENT} WHERE pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_comment).transpose()?)
}

/// Comments of a task, chronological (created_at asc byte-wise, then pid).
pub(crate) async fn comments_for_task(
    store: &Store,
    task_id: &str,
) -> anyhow::Result<Vec<CommentRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_COMMENT} WHERE task_id = $1 ORDER BY created_at COLLATE \"C\", pid"
    ))
    .bind(task_id)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read_comment).collect::<sqlx::Result<_>>()?)
}

pub(crate) async fn create_comment(
    store: &Store,
    task_id: &str,
    author_id: &str,
    content: &str,
    mentions: &[String],
    now: &str,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_commentinfo \
         (pid, task_id, author_id, content, mentioned_user_ids, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, to_jsonb($5::text[]), $6, $6)",
    )
    .bind(pid)
    .bind(task_id)
    .bind(author_id)
    .bind(content)
    .bind(mentions)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

pub(crate) async fn update_comment(
    store: &Store,
    pid: i64,
    content: &str,
    mentions: &[String],
    now: &str,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query(
            "UPDATE cmp_commentinfo SET content = $2, mentioned_user_ids = to_jsonb($3::text[]), \
             updated_at = $4 WHERE pid = $1",
        )
        .bind(pid)
        .bind(content)
        .bind(mentions)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub(crate) async fn delete_comment(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}
