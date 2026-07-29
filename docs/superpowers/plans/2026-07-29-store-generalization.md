# Store Generalization (Fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Turn the heartbeat-only `persistence::Store` into a generic, per-operation, stateless CRUD store over arke-postgres, and add the arke-postgres primitives it needs (two-phase incremental + load-by-id).

**Architecture:** Each Store op builds a fresh `PgStore` (shared pool, scoped `last`) + a fresh `World`, loads only the needed subset, mutates, persists via the two-phase incremental path, and drops. Postgres is the source of truth. Reads use `&mut World` (already `Send`); writes use `stage_incremental`/`commit_incremental` (so no `&World` is held across `.await`).

**Tech Stack:** Rust, arke + arke-postgres (local `rust-ecs`), sqlx/Postgres. DB tests use a throwaway Postgres via `podman` (`ARKE_TEST_DATABASE_URL`); testcontainers is the CI target.

**Spec:** `docs/superpowers/specs/2026-07-29-store-generalization-design.md`

---

## Preliminaries

- **Two repos:** arke-postgres changes live in `/home/qyubit/Workspace/personal/rust-ecs/arke-postgres`; the Store lives in `apps/backend-rs/crates/persistence`.
- **Test Postgres:** `podman run -d --name arke-gen-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=arke_test -p 55432:5432 docker.io/library/postgres:17-alpine`; then `ARKE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/arke_test`. Remove with `podman rm -f arke-gen-pg` when done. DB tests skip cleanly when the env var is unset.
- **Reference:** `save_incremental` (arke-postgres `store.rs`) is the source logic for the two-phase split; `materialize` (private, `store.rs`) is the basis for `load_ids`.

---

### Task 1: arke-postgres — `StagedIncremental` + `stage_incremental`/`commit_incremental`

**Files:** Modify `rust-ecs/arke-postgres/src/store.rs`, `rust-ecs/arke-postgres/src/lib.rs`

- [ ] **Step 1: Add the owned diff type + split `save_incremental`**

In `store.rs`, add near `StagedSave`:
```rust
/// Owned incremental diff (sync) ready for async commit — from `stage_incremental`.
pub struct StagedIncremental {
    deletes: Vec<i64>,
    upserts: Vec<(i64, EntityState)>, // (entity_id, (generation, per-registered params))
    next_state: HashMap<i64, EntityState>,
}
```
Add methods on `impl PgStore` and rewrite `save_incremental` to delegate:
```rust
/// Fase 1 (sync): diff `world` vs the internal sync record → owned diff (no await).
pub fn stage_incremental(&self, world: &World) -> StagedIncremental {
    let current = self.dump_state(world);
    let deletes: Vec<i64> = self.last.keys().copied().filter(|id| !current.contains_key(id)).collect();
    let upserts: Vec<(i64, EntityState)> = current.iter()
        .filter(|(id, state)| self.last.get(id) != Some(state))
        .map(|(id, state)| (*id, state.clone()))
        .collect();
    StagedIncremental { deletes, upserts, next_state: current }
}

/// Fase 2 (async): apply the diff (UPSERT version-bump + DELETE missing) in one tx,
/// update the sync record + invalidate cache. Touches no World.
pub async fn commit_incremental(&mut self, staged: StagedIncremental) -> Result<SyncStats, sqlx::Error> {
    let mut tx = self.pool.begin().await?;
    let mut stats = SyncStats { written: 0, deleted: 0 };
    let mut affected: Vec<i64> = Vec::new();
    for id in &staged.deletes {
        sqlx::query("DELETE FROM arke_entities WHERE entity_id = $1").bind(id).execute(&mut *tx).await?;
        affected.push(*id); stats.deleted += 1;
    }
    for (id, state) in &staged.upserts {
        sqlx::query(
            "INSERT INTO arke_entities (entity_id, generation, version) VALUES ($1, $2, 0) \
             ON CONFLICT (entity_id) DO UPDATE SET generation = EXCLUDED.generation, version = arke_entities.version + 1",
        ).bind(*id).bind(state.0).execute(&mut *tx).await?;
        for (ci, r) in self.registered.iter().enumerate() {
            sqlx::query(&format!("DELETE FROM {} WHERE entity_id = $1", r.table)).bind(id).execute(&mut *tx).await?;
            if let Some(params) = &state.1[ci] {
                let insert = insert_sql(r);
                let mut q = sqlx::query(&insert).bind(*id);
                for (value, col) in params.iter().zip(r.columns) { q = bind_value(q, col.ty, value); }
                q.execute(&mut *tx).await?;
            }
        }
        affected.push(*id); stats.written += 1;
    }
    tx.commit().await?;
    if let Some(c) = &self.cache && !affected.is_empty() {
        for r in &self.registered { c.invalidate(r.table, &affected).await; }
    }
    self.last = staged.next_state;
    Ok(stats)
}

pub async fn save_incremental(&mut self, world: &World) -> Result<SyncStats, sqlx::Error> {
    let staged = self.stage_incremental(world);
    self.commit_incremental(staged).await
}
```
Delete the old `save_incremental` body (replaced above).

- [ ] **Step 2: Export the type**

`lib.rs`: `pub use store::{PgStore, StagedSave, StagedIncremental, SyncStats, UpdateError};`

- [ ] **Step 3: Compile-check**

Run: `cd /home/qyubit/Workspace/personal/rust-ecs && cargo check -p arke-postgres`
Expected: PASS.

- [ ] **Step 4: Commit (rust-ecs)**

```bash
cd /home/qyubit/Workspace/personal/rust-ecs
git add arke-postgres/src/store.rs arke-postgres/src/lib.rs
git commit -m "feat(arke-postgres): two-phase incremental (stage_incremental/commit_incremental)"
```

---

### Task 2: arke-postgres — public `load_ids` (load entities by id, return handles)

**Files:** Modify `rust-ecs/arke-postgres/src/store.rs`, `lib.rs`

- [ ] **Step 1: Read `materialize`** (`store.rs`, ~line 342) to see how it spawns entities via `spawn_at` and whether it can return the spawned `Vec<Entity>`.

- [ ] **Step 2: Add `load_ids`** returning the spawned entities:
```rust
/// Materialize specific entities (all their components) by id, returning the handles.
/// Syncs the internal record for the loaded ids (safe with save_incremental).
pub async fn load_ids(&mut self, world: &mut World, ids: &[i64]) -> Result<Vec<Entity>, sqlx::Error> {
    // Base on materialize; collect the entities it spawns (spawn_at(index, generation)).
    // If materialize doesn't return them, reconstruct: for each id, read generation from
    // arke_entities and world.spawn_at(id as u32, generation) — mirror materialize's logic.
    // Then self.last sync for these ids (dump_state subset) as load_where does.
}
```
Implement it faithfully to `materialize` (adjust to the real internal API). Keep `materialize` private; `load_ids` is the public wrapper.

- [ ] **Step 3: Compile-check + commit**

Run: `cargo check -p arke-postgres` → PASS. Commit `feat(arke-postgres): public load_ids (materialize by id → entities)`.

---

### Task 3: persistence — generic `Store` skeleton (pool + registrar + `fresh`)

**Files:** Modify `apps/backend-rs/crates/persistence/src/lib.rs`, `crates/persistence/Cargo.toml`

- [ ] **Step 1: Replace the heartbeat Store with the generic shell**
```rust
use std::sync::Arc;
use anyhow::Result;
use arke::{Bundle, Component, Entity, World};
use arke_postgres::{PgComponent, PgStore};
use sqlx::PgPool;

pub struct Store {
    pool: PgPool,
    register: Arc<dyn Fn(&mut PgStore) + Send + Sync>,
}

impl Store {
    pub async fn connect(
        database_url: &str,
        register: impl Fn(&mut PgStore) + Send + Sync + 'static,
    ) -> Result<Self> {
        let mut pg = PgStore::connect(database_url).await?;
        register(&mut pg);
        pg.migrate().await?;
        Ok(Self { pool: pg.pool_ref_or_clone(), register: Arc::new(register) })
    }

    /// A fresh registered PgStore sharing the pool (scoped `last` per operation).
    fn fresh(&self) -> PgStore {
        let mut pg = PgStore::from_pool(self.pool.clone());
        (self.register)(&mut pg);
        pg
    }
}
```
> `PgStore::from_pool(PgPool)` exists; obtaining the `PgPool` from the connected store may need a small accessor — if `PgStore` has no `pool()` getter, connect via `PgPoolOptions` directly here and build the first `PgStore` with `from_pool`. Adjust in this step (read `PgStore::connect`/`from_pool`).

- [ ] **Step 2: `persistence/Cargo.toml`** add `sqlx = { workspace = true }` if needed for `PgPool`/`PgPoolOptions` (add `sqlx` to workspace deps: `sqlx = { version = "0.8", default-features = false, features = ["runtime-tokio", "postgres"] }`).

- [ ] **Step 3: Compile-check**

Run: `cd apps/backend-rs && cargo check -p persistence`
Expected: PASS (Store shell compiles; no ops yet).

---

### Task 4: persistence — `create` + `get`

**Files:** Modify `crates/persistence/src/lib.rs`

- [ ] **Step 1: Implement `create` and `get`**
```rust
impl Store {
    /// Spawn an entity from a component bundle, persist it, return its id (entity index).
    pub async fn create<B: Bundle>(&self, bundle: B) -> Result<u32> {
        let mut pg = self.fresh();
        let mut w = World::new();
        let e = w.spawn_bundle(bundle);
        let staged = pg.stage_incremental(&w);       // sync
        pg.commit_incremental(staged).await?;         // async, no World
        Ok(e.index())
    }

    /// Load one entity's component `T` by id.
    pub async fn get<T: PgComponent + Component + Clone>(&self, id: u32) -> Result<Option<T>> {
        let mut pg = self.fresh();
        let mut w = World::new();
        let entities = pg.load_ids(&mut w, &[i64::from(id)]).await?;
        Ok(entities.first().and_then(|&e| w.get::<T>(e).cloned()))
    }
}
```

- [ ] **Step 2: Integration test — create/get round-trip** (gated on `ARKE_TEST_DATABASE_URL`)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use arke_postgres::PgComponent;

    #[derive(PgComponent, Debug, Clone, PartialEq)]
    struct Note { text: String }

    fn register(pg: &mut PgStore) { pg.register::<Note>(); }

    #[tokio::test]
    async fn create_then_get() {
        let Ok(url) = std::env::var("ARKE_TEST_DATABASE_URL") else { eprintln!("skip: no DB"); return; };
        let store = Store::connect(&url, register).await.unwrap();
        let id = store.create((Note { text: "hello".into() },)).await.unwrap();
        let got = store.get::<Note>(id).await.unwrap().unwrap();
        assert_eq!(got.text, "hello");
    }
}
```

- [ ] **Step 3: Run against throwaway Postgres**

Start `arke-gen-pg` (see Preliminaries), then:
`ARKE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/arke_test cargo test -p persistence`
Expected: PASS. Adjust the `load_ids`/`spawn_bundle` calls to the real API if the compiler/DB disagree.

- [ ] **Step 4: Commit** `feat(persistence): generic Store create/get (per-op, stage_incremental)`

---

### Task 5: persistence — `query`

**Files:** Modify `crates/persistence/src/lib.rs`

- [ ] **Step 1: Read the `arke_postgres::Query` builder API** (`filter`/`order_by`/`limit`/`load`) and `Field`/`Filter`/`Dir` (from earlier exploration).

- [ ] **Step 2: Implement `query`** (builder closure + mapper so `World` never leaks):
```rust
pub async fn query<T, R>(
    &self,
    build: impl FnOnce(arke_postgres::Query<'_, T>) -> arke_postgres::Query<'_, T>,
    map: impl Fn(&World) -> Vec<R>,
) -> Result<Vec<R>>
where T: PgComponent {
    let mut pg = self.fresh();
    let mut w = World::new();
    let q = build(pg.query::<T>());
    q.load(&mut w).await?;
    Ok(map(&w))
}
```
> The borrow of `pg` by `query::<T>()` then `load(&mut w)` is fine (query borrows pg, load consumes the builder). Adjust lifetimes if the builder holds `&mut pg` across the closure — if so, restructure to `let q = pg.query::<T>(); let q = build(q); q.load(&mut w).await?;`.

- [ ] **Step 3: Test** — insert 2 `Note`s, `query::<Note>` filtered, assert. Run vs throwaway PG. Commit `feat(persistence): generic Store query`.

---

### Task 6: persistence — `update` + `delete`

**Files:** Modify `crates/persistence/src/lib.rs`

- [ ] **Step 1: Implement**
```rust
pub async fn update(&self, id: u32, mutate: impl FnOnce(&mut World, Entity)) -> Result<()> {
    let mut pg = self.fresh();
    let mut w = World::new();
    let entities = pg.load_ids(&mut w, &[i64::from(id)]).await?;
    if let Some(&e) = entities.first() {
        mutate(&mut w, e);
        let staged = pg.stage_incremental(&w);
        pg.commit_incremental(staged).await?;
    }
    Ok(())
}

pub async fn delete(&self, id: u32) -> Result<()> {
    let mut pg = self.fresh();
    let mut w = World::new();
    let entities = pg.load_ids(&mut w, &[i64::from(id)]).await?;
    if let Some(&e) = entities.first() { w.despawn(e); }
    let staged = pg.stage_incremental(&w);      // e now missing vs last → DELETE
    pg.commit_incremental(staged).await?;
    Ok(())
}
```

- [ ] **Step 2: Test** update (change Note.text, re-get asserts new value) + delete (get returns None). Run vs PG. Commit `feat(persistence): generic Store update/delete`.

---

### Task 7: Rewire `DbCheck` + verify end-to-end

**Files:** Modify `crates/transport/src/lib.rs`, `crates/app/src/main.rs`, `crates/domain/src/lib.rs`

- [ ] **Step 1:** In `app/main.rs`, pass a registrar to `Store::connect` (`|pg| pg.register::<HeartbeatAt>()`).

- [ ] **Step 2:** Rewrite `db_check` handler to use the generic Store:
```rust
let id = store.create((HeartbeatAt { ts: now_iso() },)).await.map_err(|e| ConnectError::new_internal(e.to_string()))?;
let hb = store.get::<HeartbeatAt>(id).await.map_err(...)?.ok_or_else(...)?;
Ok(ConnectResponse::new(pb::DbCheckResponse { heartbeat_id: id.to_string(), ts: hb.ts }))
```
`HeartbeatAt` needs `Clone` (already) — add `PartialEq` if a test needs it.

- [ ] **Step 3: Full build + unit tests**

Run: `cd apps/backend-rs && cargo test`
Expected: PASS (workspace compiles; DB-gated tests skip without env).

- [ ] **Step 4: Live e2e smoke** (throwaway PG + server)

Start `arke-gen-pg`; boot `DATABASE_URL=... AUTH_JWT_SECRET=dev PORT=3010 cargo run -p app`; then
`curl -X POST localhost:3010/sedjiwa.tasks.health.v1.HealthService/DbCheck -H 'content-type: application/json' -d '{}'` twice → 200 with differing `ts`. Stop server + `podman rm -f arke-gen-pg`.

- [ ] **Step 5: Commit** `feat: DbCheck via generic Store; remove heartbeat-specific Store`

---

## Self-Review

**Spec coverage:** §3 arke-postgres two-phase incremental → Tasks 1–2. §4 Store create/get/query/update/delete → Tasks 3–6. §5 skeleton→generic (DbCheck) → Task 7. §2 Send-safety upheld (writes via stage_incremental; reads via `&mut World`).

**Placeholder scan:** The `load_ids` body (Task 2) and the `pool` accessor (Task 3) are explicitly marked "read + adjust to the real internal API" with a concrete fallback each — bounded by a compile/test gate, not vague TODOs.

**Type consistency:** `StagedIncremental`, `stage_incremental`/`commit_incremental`, `load_ids -> Vec<Entity>`, `Store::{connect, fresh, create, get, query, update, delete}`, `register: Arc<dyn Fn(&mut PgStore)…>` used consistently across tasks.
