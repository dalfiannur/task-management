//! Persistence: `Store` wraps an arke `World` (in-memory cache) + `arke-postgres`
//! `PgStore` (source of truth). arke persists the whole `World` (save/load), so the
//! World itself is the cache; a write saves the world, a read re-loads from Postgres.
//!
//! Skeleton scope: a single "heartbeat" entity to prove the Arke↔Postgres round-trip.
//! Generalizing to `get<T>`/`put<T>` across components is the first task of the
//! create-project flow (see tech-stack / foundation §12).

use anyhow::Result;
use arke::{Entity, World};
use arke_postgres::PgStore;
use domain::HeartbeatAt;
use tokio::sync::Mutex;

pub struct Store {
    inner: Mutex<Inner>,
}

struct Inner {
    pg: PgStore,
    world: World,
    heartbeat: Option<Entity>,
}

impl Store {
    /// Connect, register persisted components, and reconcile schema.
    pub async fn connect(database_url: &str) -> Result<Self> {
        let mut pg = PgStore::connect(database_url).await?;
        pg.register::<HeartbeatAt>();
        pg.migrate().await?;
        Ok(Self {
            inner: Mutex::new(Inner {
                pg,
                world: World::new(),
                heartbeat: None,
            }),
        })
    }

    /// Write/overwrite the singleton heartbeat and persist the whole world.
    /// Returns the heartbeat entity handle.
    pub async fn write_heartbeat(&self, ts: String) -> Result<Entity> {
        let g = &mut *self.inner.lock().await;
        let Inner {
            pg,
            world,
            heartbeat,
        } = g;
        let e = match *heartbeat {
            Some(e) => {
                world.remove::<HeartbeatAt>(e);
                world.insert(e, HeartbeatAt { ts });
                e
            }
            None => {
                let e = world.spawn();
                world.insert(e, HeartbeatAt { ts });
                *heartbeat = Some(e);
                e
            }
        };
        pg.save(world).await?;
        Ok(e)
    }

    /// Read a heartbeat back **from Postgres** via a fresh `World` load — proves the
    /// round-trip and that the value is the source of truth, not a stale cache.
    pub async fn read_heartbeat_from_db(&self, e: Entity) -> Result<Option<HeartbeatAt>> {
        let g = &mut *self.inner.lock().await;
        let mut fresh = World::new();
        g.pg.load(&mut fresh).await?;
        Ok(fresh.get::<HeartbeatAt>(e).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration test. Target per testing policy: testcontainers (ephemeral Postgres).
    // Until Docker is available this gated form compiles and skips cleanly.
    #[tokio::test]
    async fn write_then_read_roundtrips_and_reflects_latest_write() {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipping: TEST_DATABASE_URL not set");
            return;
        };
        let store = Store::connect(&url).await.unwrap();

        let e = store
            .write_heartbeat("2026-07-29T00:00:00Z".into())
            .await
            .unwrap();
        let first = store.read_heartbeat_from_db(e).await.unwrap().unwrap();
        assert_eq!(first.ts, "2026-07-29T00:00:00Z");

        // Overwrite → newest value must be read back from the DB.
        let e2 = store
            .write_heartbeat("2026-07-29T01:00:00Z".into())
            .await
            .unwrap();
        let second = store.read_heartbeat_from_db(e2).await.unwrap().unwrap();
        assert_eq!(second.ts, "2026-07-29T01:00:00Z");
    }
}
