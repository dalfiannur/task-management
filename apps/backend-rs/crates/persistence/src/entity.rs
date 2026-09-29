//! Entity bookkeeping shared by every domain's SQL.
//!
//! The schema (`schema.sql`) is `arke_entities (pid BIGSERIAL, version BIGINT)`
//! plus one `cmp_<name>` table per component, each keyed by `pid` with
//! `ON DELETE CASCADE`. Two invariants hold for every write:
//!
//! - every entity has an `arke_entities` row, allocated first — the component
//!   rows reference it, and the pid sequence is shared across every kind;
//! - every write bumps `version`.
//!
//! Deleting is `DELETE FROM arke_entities` and needs nothing more: the cascade
//! removes the component rows.
//!
//! Integer parameters are written with an explicit cast (`$n::int4`). While
//! arke still ran alongside, that was load-bearing — sqlx caches prepared
//! statements by SQL text, and arke bound integers as `i64` into INSERTs shaped
//! exactly like hand-written ones. It is kept because it makes the column type
//! explicit instead of inferred from whichever caller prepared the text first.

use sqlx::PgConnection;

/// Allocate a new entity and return its `pid`. Run it inside the transaction
/// that inserts the entity's component rows, so a failed insert leaves no
/// empty entity behind.
pub async fn new_pid(conn: &mut PgConnection) -> sqlx::Result<i64> {
    sqlx::query_scalar("INSERT INTO arke_entities (version) VALUES (0) RETURNING pid")
        .fetch_one(conn)
        .await
}

/// Bump `pid`'s version, as every write does. Returns whether the entity
/// exists, which callers use as their not-found check before touching
/// component rows.
pub async fn touch(conn: &mut PgConnection, pid: i64) -> sqlx::Result<bool> {
    let r = sqlx::query("UPDATE arke_entities SET version = version + 1 WHERE pid = $1")
        .bind(pid)
        .execute(conn)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Delete an entity; the cascade takes its component rows with it.
pub async fn delete(conn: &mut PgConnection, pid: i64) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM arke_entities WHERE pid = $1")
        .bind(pid)
        .execute(conn)
        .await?;
    Ok(())
}
