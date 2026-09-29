//! Entity bookkeeping for code that talks to the component tables with plain
//! sqlx instead of through arke.
//!
//! The tables are the ones arke-postgres created and still owns the schema of:
//! `arke_entities (pid BIGSERIAL, version BIGINT)` plus one `cmp_<name>` table
//! per component, each keyed by `pid` with `ON DELETE CASCADE`. While both
//! access paths run side by side, the sqlx side has to keep arke's two
//! invariants so neither sees a row the other would not have written:
//!
//! - every entity has an `arke_entities` row, allocated first — the component
//!   rows reference it, and the pid sequence is shared across every kind;
//! - every write bumps `version`, as arke's `commit_update` does.
//!
//! Deleting is `DELETE FROM arke_entities` and needs nothing here: the cascade
//! removes the component rows.
//!
//! **Cast every integer parameter (`$n::int4`).** sqlx caches prepared
//! statements per connection keyed on the SQL text alone, and arke binds every
//! integer as `i64` into INSERTs shaped exactly like hand-written ones
//! (`INSERT INTO cmp_x (pid, value) VALUES ($1, $2)`). Whichever side prepares
//! the text first fixes its parameter types for that connection, so an `i32`
//! bound into arke's `int8` slot fails with "insufficient data left in
//! message". The cast makes the text different and the type explicit. Text,
//! bool and pid parameters bind the same type on both sides and are safe.

use sqlx::PgConnection;

/// Allocate a new entity and return its `pid`. Run it inside the transaction
/// that inserts the entity's component rows, so a failed insert leaves no
/// empty entity behind.
pub async fn new_pid(conn: &mut PgConnection) -> sqlx::Result<i64> {
    sqlx::query_scalar("INSERT INTO arke_entities (version) VALUES (0) RETURNING pid")
        .fetch_one(conn)
        .await
}

/// Bump `pid`'s version, as every arke write does. Returns whether the entity
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
