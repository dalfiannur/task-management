//! Postgres access: the connection pool, the schema, and entity bookkeeping.
//!
//! The data model is one entity per thing (a pid allocated in `arke_entities`)
//! with one `cmp_<component>` row per aspect of it — the layout arke-postgres
//! created, kept as-is when arke was removed (see `schema.sql`). Each domain's
//! reads and writes live next to its handlers in `transport` as plain sqlx;
//! this crate owns what they share: [`Store`] (pool + schema), [`entity`] (pid
//! allocation, version bumps, deletes) and [`rows`] (component structs as rows,
//! for seeds and fixtures).

use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub mod entity;
pub mod rows;
pub mod search;
pub use rows::{Row, Rows};
pub use search::{SearchDoc, SearchRow};

/// Idempotent DDL for every component table; runs on each connect.
const SCHEMA: &str = include_str!("schema.sql");

/// Advisory-lock key serialising schema setup across concurrent connects.
/// Even an `IF NOT EXISTS` DDL statement takes its locks before it finds the
/// object already there, so several processes starting at once (replicas, or
/// the test suite's parallel `Store::connect`s) deadlock without it.
const SCHEMA_LOCK: i64 = 0x7365_646a_6977_6100; // "sedjiwa\0"


pub struct Store {
    pool: PgPool,
}

impl Store {
    /// Connect and bring the schema up to date (every statement is idempotent).
    pub async fn connect(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("SELECT pg_advisory_lock($1)")
            .bind(SCHEMA_LOCK)
            .execute(&mut *conn)
            .await?;
        let migrated = async {
            // One statement at a time, each in its own implicit transaction, so
            // a statement's locks are released before the next is taken. Run as
            // one script, every lock would be held to the end while other
            // connections insert into the same tables in another order.
            for stmt in schema_statements() {
                sqlx::query(stmt).execute(&mut *conn).await?;
            }
            search::migrate(&mut conn).await
        }
        .await;
        sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(SCHEMA_LOCK)
            .execute(&mut *conn)
            .await?;
        migrated?;
        drop(conn);
        Ok(Self { pool })
    }

    /// The shared pool.
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Create an entity from component rows, in one transaction; return its
    /// `pid`. For seeds and fixtures — request paths write through their
    /// domain's `record.rs`.
    pub async fn create(&self, rows: impl Rows) -> Result<i64> {
        let mut tx = self.pool.begin().await?;
        let pid = entity::new_pid(&mut tx).await?;
        for (table, values) in rows.into_rows() {
            insert(&mut tx, table, pid, values, false).await?;
        }
        tx.commit().await?;
        Ok(pid)
    }

    /// Add a component row to an existing entity, replacing the one it already
    /// has of that kind. Does nothing if the entity does not exist.
    pub async fn attach(&self, pid: i64, row: impl Row) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        if entity::touch(&mut tx, pid).await? {
            insert(&mut tx, row_table(&row), pid, row.into_values(), true).await?;
            tx.commit().await?;
        }
        Ok(())
    }

    /// Delete an entity; its component rows cascade.
    pub async fn delete(&self, pid: i64) -> Result<()> {
        let mut conn = self.pool.acquire().await?;
        entity::delete(&mut conn, pid).await?;
        Ok(())
    }
}

/// `schema.sql` split into its statements, skipping chunks that are only
/// comments or whitespace. No statement contains a `;` of its own.
fn schema_statements() -> impl Iterator<Item = &'static str> {
    SCHEMA.split(';').filter(|chunk| {
        chunk.lines().any(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with("--")
        })
    })
}

fn row_table<R: Row>(_: &R) -> &'static str {
    R::TABLE
}

async fn insert(
    conn: &mut sqlx::PgConnection,
    table: &str,
    pid: i64,
    values: Vec<(&'static str, rows::Val)>,
    replace: bool,
) -> sqlx::Result<()> {
    let cols: Vec<&str> = values.iter().map(|(c, _)| *c).collect();
    let placeholders: Vec<String> = values
        .iter()
        .enumerate()
        .map(|(i, (_, v))| v.placeholder(i + 2))
        .collect();
    let mut sql = format!(
        "INSERT INTO {table} (pid, {}) VALUES ($1, {})",
        cols.join(", "),
        placeholders.join(", ")
    );
    if replace {
        let set: Vec<String> = cols.iter().map(|c| format!("{c} = EXCLUDED.{c}")).collect();
        sql.push_str(&format!(" ON CONFLICT (pid) DO UPDATE SET {}", set.join(", ")));
    }
    let mut q = sqlx::query(&sql).bind(pid);
    for (_, v) in values {
        q = match v {
            rows::Val::Text(s) => q.bind(s),
            rows::Val::OptText(s) => q.bind(s),
            rows::Val::Int(n) => q.bind(n),
            rows::Val::BigInt(n) => q.bind(n),
            rows::Val::Bool(b) => q.bind(b),
            rows::Val::TextList(v) => q.bind(v),
        };
    }
    q.execute(conn).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::HeartbeatAt;

    async fn store() -> Option<Store> {
        let url = std::env::var("PERSISTENCE_TEST_DATABASE_URL").ok()?;
        Some(Store::connect(&url).await.unwrap())
    }

    async fn ts(s: &Store, pid: i64) -> Option<String> {
        sqlx::query_scalar("SELECT ts FROM cmp_heartbeatat WHERE pid = $1")
            .bind(pid)
            .fetch_optional(s.pool())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn create_attach_delete() {
        let Some(s) = store().await else {
            eprintln!("skip: PERSISTENCE_TEST_DATABASE_URL not set");
            return;
        };
        let id = s.create((HeartbeatAt { ts: "hello".into() },)).await.unwrap();
        assert_eq!(ts(&s, id).await.as_deref(), Some("hello"));
        s.attach(id, HeartbeatAt { ts: "world".into() }).await.unwrap();
        assert_eq!(ts(&s, id).await.as_deref(), Some("world"), "attach replaces the row");
        s.delete(id).await.unwrap();
        assert_eq!(ts(&s, id).await, None, "delete cascades");
    }

    #[tokio::test]
    async fn two_creates_have_distinct_pids() {
        let Some(s) = store().await else {
            eprintln!("skip: PERSISTENCE_TEST_DATABASE_URL not set");
            return;
        };
        let a = s.create((HeartbeatAt { ts: "a".into() },)).await.unwrap();
        let b = s.create((HeartbeatAt { ts: "b".into() },)).await.unwrap();
        assert_ne!(a, b);
        s.delete(a).await.unwrap();
        s.delete(b).await.unwrap();
    }

    #[tokio::test]
    async fn attach_to_a_missing_entity_does_nothing() {
        let Some(s) = store().await else {
            eprintln!("skip: PERSISTENCE_TEST_DATABASE_URL not set");
            return;
        };
        let id = s.create((HeartbeatAt { ts: "x".into() },)).await.unwrap();
        s.delete(id).await.unwrap();
        s.attach(id, HeartbeatAt { ts: "ghost".into() }).await.unwrap();
        assert_eq!(ts(&s, id).await, None);
    }
}
