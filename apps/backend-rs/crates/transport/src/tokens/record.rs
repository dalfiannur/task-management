//! PAT rows. A single flat `TokenRecord` so handlers and the `mcp` crate don't
//! have to touch the component tables one by one.
//!
//! Plain sqlx over the component tables arke-postgres created (see
//! `persistence::entity`). A token is one entity carrying `cmp_tokensecret`,
//! `cmp_tokenowner` and `cmp_tokeninfo`, optionally `cmp_tokenusage`.

use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

#[derive(Debug, Clone)]
pub struct TokenRecord {
    pub pid: i64,
    pub user_id: String,
    pub name: String,
    pub preview: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
}

const SELECT_TOKEN: &str = "\
    SELECT s.pid, o.user_id, i.name, s.preview, i.created_at, i.expires_at, u.last_used_at \
    FROM cmp_tokensecret s \
    JOIN cmp_tokenowner o ON o.pid = s.pid \
    JOIN cmp_tokeninfo i ON i.pid = s.pid \
    LEFT JOIN cmp_tokenusage u ON u.pid = s.pid";

fn read(row: &PgRow) -> sqlx::Result<TokenRecord> {
    Ok(TokenRecord {
        pid: row.try_get("pid")?,
        user_id: row.try_get("user_id")?,
        name: row.try_get("name")?,
        preview: row.try_get("preview")?,
        created_at: row.try_get("created_at")?,
        expires_at: row.try_get("expires_at")?,
        last_used_at: row.try_get("last_used_at")?,
    })
}

/// One user's tokens, newest first (created_at desc byte-wise, then pid desc).
pub async fn tokens_for_owner(store: &Store, user_id: &str) -> anyhow::Result<Vec<TokenRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_TOKEN} WHERE o.user_id = $1 ORDER BY i.created_at COLLATE \"C\" DESC, s.pid DESC"
    ))
    .bind(user_id)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read).collect::<sqlx::Result<_>>()?)
}

pub async fn load_token(store: &Store, pid: i64) -> anyhow::Result<Option<TokenRecord>> {
    let row = sqlx::query(&format!("{SELECT_TOKEN} WHERE s.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read).transpose()?)
}

/// Lookup by digest — the hot path for every MCP tool call. `hash` is unique
/// and indexed.
pub async fn find_by_hash(store: &Store, hash: &str) -> anyhow::Result<Option<TokenRecord>> {
    let row = sqlx::query(&format!("{SELECT_TOKEN} WHERE s.hash = $1"))
        .bind(hash)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read).transpose()?)
}

pub(crate) struct NewToken<'a> {
    pub hash: &'a str,
    pub preview: &'a str,
    pub user_id: &'a str,
    pub name: &'a str,
    pub created_at: &'a str,
    pub expires_at: Option<String>,
}

pub(crate) async fn create_token(store: &Store, t: NewToken<'_>) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query("INSERT INTO cmp_tokensecret (pid, hash, preview) VALUES ($1, $2, $3)")
        .bind(pid)
        .bind(t.hash)
        .bind(t.preview)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_tokenowner (pid, user_id) VALUES ($1, $2)")
        .bind(pid)
        .bind(t.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_tokeninfo (pid, name, created_at, expires_at) VALUES ($1, $2, $3, $4)")
        .bind(pid)
        .bind(t.name)
        .bind(t.created_at)
        .bind(t.expires_at)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_tokenusage (pid, last_used_at) VALUES ($1, NULL)")
        .bind(pid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(pid)
}

/// Stamp a token's last use.
pub async fn record_usage(store: &Store, pid: i64, at: &str) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query(
            "INSERT INTO cmp_tokenusage (pid, last_used_at) VALUES ($1, $2) \
             ON CONFLICT (pid) DO UPDATE SET last_used_at = EXCLUDED.last_used_at",
        )
        .bind(pid)
        .bind(at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub(crate) async fn delete_token(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}
