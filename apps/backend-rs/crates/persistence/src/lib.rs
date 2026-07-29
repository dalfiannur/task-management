//! Generic, per-operation, stateless `Store` over arke-postgres's pid API (RFC-0034).
//!
//! Each op builds a fresh `PgStore` (shared pool) + a fresh `World`, does one
//! pid-addressed operation, and drops. `pid` (DB `BIGSERIAL`) is the persistent id
//! — decoupled from arke's ephemeral World index — so per-op create yields globally
//! unique ids (no collisions, no dense-Vec blowup). Postgres is the source of truth;
//! stateless → multi-replica safe. Writes read the World synchronously before any
//! `.await`, so handler futures stay `Send` (no unsafe, no actor).

use std::sync::Arc;

use anyhow::Result;
use arke::{Bundle, Component, Entity, World};
use arke_postgres::{PgComponent, PgStore};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub struct Store {
    pool: PgPool,
    /// Registers every persisted component type on a fresh `PgStore` each op.
    register: Arc<dyn Fn(&mut PgStore) + Send + Sync>,
}

impl Store {
    /// Connect, register components, reconcile schema once.
    pub async fn connect(
        database_url: &str,
        register: impl Fn(&mut PgStore) + Send + Sync + 'static,
    ) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        let mut pg = PgStore::from_pool(pool.clone());
        register(&mut pg);
        pg.migrate().await?;
        Ok(Self {
            pool,
            register: Arc::new(register),
        })
    }

    /// A fresh registered `PgStore` sharing the pool.
    fn fresh(&self) -> PgStore {
        let mut pg = PgStore::from_pool(self.pool.clone());
        (self.register)(&mut pg);
        pg
    }

    /// Create an entity from a component bundle; return its persistent `pid`.
    pub async fn create<B: Bundle>(&self, bundle: B) -> Result<i64> {
        let pg = self.fresh();
        let mut world = World::new();
        let e = world.spawn_bundle(bundle);
        let staged = pg.stage_insert(&world, e);
        Ok(pg.commit_insert(staged).await?)
    }

    /// Read one entity's component `T` by `pid`.
    pub async fn get<T: PgComponent + Component + Clone>(&self, pid: i64) -> Result<Option<T>> {
        let pg = self.fresh();
        let mut world = World::new();
        Ok(pg
            .fetch(&mut world, pid)
            .await?
            .and_then(|e| world.get::<T>(e).cloned()))
    }

    /// Load `pid`, run a mutator, persist the change.
    pub async fn update(&self, pid: i64, mutate: impl FnOnce(&mut World, Entity)) -> Result<()> {
        let pg = self.fresh();
        let mut world = World::new();
        if let Some(e) = pg.fetch(&mut world, pid).await? {
            mutate(&mut world, e);
            let staged = pg.stage_update(&world, e);
            pg.commit_update(pid, staged).await?;
        }
        Ok(())
    }

    /// Delete an entity by `pid`.
    pub async fn delete(&self, pid: i64) -> Result<()> {
        Ok(self.fresh().remove(pid).await?)
    }

    /// Query entities matching `predicate` (trusted SQL `WHERE` over `T`'s table);
    /// map the loaded `World` + `(pid, Entity)` pairs to results.
    pub async fn query<T, R>(
        &self,
        predicate: Option<&str>,
        map: impl FnOnce(&World, &[(i64, Entity)]) -> Vec<R>,
    ) -> Result<Vec<R>>
    where
        T: PgComponent,
    {
        let pg = self.fresh();
        let mut world = World::new();
        let pairs = pg.query_pids::<T>(&mut world, predicate).await?;
        Ok(map(&world, &pairs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arke_postgres::PgComponent;

    #[derive(PgComponent, Debug, Clone, PartialEq)]
    struct Note {
        text: String,
    }

    fn register(pg: &mut PgStore) {
        pg.register::<Note>();
    }

    async fn store() -> Option<Store> {
        let url = std::env::var("ARKE_TEST_DATABASE_URL").ok()?;
        Some(Store::connect(&url, register).await.unwrap())
    }

    #[tokio::test]
    async fn create_get_update_delete() {
        let Some(s) = store().await else {
            eprintln!("skip: ARKE_TEST_DATABASE_URL not set");
            return;
        };
        let id = s.create((Note { text: "hello".into() },)).await.unwrap();
        assert_eq!(s.get::<Note>(id).await.unwrap().unwrap().text, "hello");
        s.update(id, |w, e| {
            w.remove::<Note>(e);
            w.insert(e, Note { text: "world".into() });
        })
        .await
        .unwrap();
        assert_eq!(s.get::<Note>(id).await.unwrap().unwrap().text, "world");
        s.delete(id).await.unwrap();
        assert!(s.get::<Note>(id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn two_creates_have_distinct_pids_and_both_queried() {
        let Some(s) = store().await else {
            eprintln!("skip: ARKE_TEST_DATABASE_URL not set");
            return;
        };
        let a = s.create((Note { text: "tc-alpha".into() },)).await.unwrap();
        let b = s.create((Note { text: "tc-beta".into() },)).await.unwrap();
        assert_ne!(a, b, "per-op create must yield distinct pids");

        let texts = s
            .query::<Note, String>(None, |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(_, e)| w.get::<Note>(*e).map(|n| n.text.clone()))
                    .collect()
            })
            .await
            .unwrap();
        assert!(texts.contains(&"tc-alpha".to_string()));
        assert!(texts.contains(&"tc-beta".to_string()));

        s.delete(a).await.unwrap();
        s.delete(b).await.unwrap();
    }
}
