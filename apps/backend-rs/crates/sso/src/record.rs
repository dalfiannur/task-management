//! `cmp_ssoidentity`: which local user a portal account is. A component on
//! the user's entity (gone with the user); `(issuer, subject)` is unique.

use persistence::{entity, Store};

/// The local user linked to this portal account.
pub async fn user_for(store: &Store, issuer: &str, subject: &str) -> anyhow::Result<Option<i64>> {
    Ok(sqlx::query_scalar("SELECT pid FROM cmp_ssoidentity WHERE issuer = $1 AND subject = $2")
        .bind(issuer)
        .bind(subject)
        .fetch_optional(store.pool())
        .await?)
}

/// Whether this user is already linked (to any portal account).
pub async fn is_linked(store: &Store, pid: i64) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM cmp_ssoidentity WHERE pid = $1)")
        .bind(pid)
        .fetch_one(store.pool())
        .await?)
}

/// Link `pid` to the portal account. `false` when that user or that portal
/// account got linked in the meantime (nothing written).
pub async fn link(store: &Store, pid: i64, issuer: &str, subject: &str, now: &str) -> anyhow::Result<bool> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(false);
    }
    let inserted = sqlx::query(
        "INSERT INTO cmp_ssoidentity (pid, issuer, subject, linked_at) VALUES ($1, $2, $3, $4) \
         ON CONFLICT DO NOTHING",
    )
    .bind(pid)
    .bind(issuer)
    .bind(subject)
    .bind(now)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(false);
    }
    tx.commit().await?;
    Ok(true)
}
