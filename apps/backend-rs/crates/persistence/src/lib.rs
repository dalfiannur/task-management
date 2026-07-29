//! Persistence: `Store` wraps an arke `World` (in-memory working set) + `arke-postgres`
//! `PgStore` (source of truth).
//!
//! Threading model (why two locks): arke's `World` is `Send` but `!Sync`, and the
//! async DB writes must not hold `&World` across `.await`. arke-postgres 0.11's
//! two-phase API solves this: `stage(&World)` is **synchronous** (reads the World
//! into an owned snapshot), and `commit(snapshot)` is **async** (touches no World).
//! So we keep the `World` under a **std mutex held only during the sync `stage`**,
//! and the `PgStore` under a **tokio mutex held across the async `commit`**. The
//! World is never held across `.await`, so handler futures are `Send` — no `unsafe`,
//! no actor.
//!
//! Skeleton scope: a single "heartbeat" entity to prove the Arke↔Postgres round-trip.

use std::sync::Mutex as StdMutex;

use anyhow::Result;
use arke::{Entity, World};
use arke_postgres::PgStore;
use domain::HeartbeatAt;
use tokio::sync::Mutex as TokioMutex;

pub struct Store {
    /// In-memory working set. Guarded by a std mutex held **only** during the
    /// synchronous `stage` — never across `.await`.
    world: StdMutex<WorldState>,
    /// Source of truth. Guarded by a tokio mutex (Send guard) held across `commit`.
    pg: TokioMutex<PgStore>,
}

struct WorldState {
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
            world: StdMutex::new(WorldState {
                world: World::new(),
                heartbeat: None,
            }),
            pg: TokioMutex::new(pg),
        })
    }

    /// Write/overwrite the singleton heartbeat and persist the world.
    /// Returns the heartbeat entity handle.
    pub async fn write_heartbeat(&self, ts: String) -> Result<Entity> {
        let mut pg = self.pg.lock().await; // tokio guard (Send) held across commit
        let (e, staged) = {
            // Sync scope: mutate the World and stage it. The std guard is dropped
            // at the end of this block, before any `.await`.
            let mut ws = self.world.lock().unwrap();
            let e = match ws.heartbeat {
                Some(e) => {
                    ws.world.remove::<HeartbeatAt>(e);
                    ws.world.insert(e, HeartbeatAt { ts });
                    e
                }
                None => {
                    let e = ws.world.spawn();
                    ws.world.insert(e, HeartbeatAt { ts });
                    ws.heartbeat = Some(e);
                    e
                }
            };
            let staged = pg.stage(&ws.world); // synchronous — no await, owned result
            (e, staged)
        };
        pg.commit(staged).await?; // async — touches no World
        Ok(e)
    }

    /// Read a heartbeat back **from Postgres** via a fresh `World` load — proves the
    /// round-trip and that the value is the source of truth, not a stale cache.
    pub async fn read_heartbeat_from_db(&self, e: Entity) -> Result<Option<HeartbeatAt>> {
        let mut pg = self.pg.lock().await;
        let mut fresh = World::new(); // local, not shared — Send is enough
        pg.load(&mut fresh).await?;
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

        let e2 = store
            .write_heartbeat("2026-07-29T01:00:00Z".into())
            .await
            .unwrap();
        let second = store.read_heartbeat_from_db(e2).await.unwrap().unwrap();
        assert_eq!(second.ts, "2026-07-29T01:00:00Z");
    }
}
