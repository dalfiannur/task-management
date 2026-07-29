# RFC-0034 (Decoupled `pid`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Implement RFC-0034 in `arke-postgres` (→ `0.12.0`): decouple a DB-allocated `pid` from arke's ephemeral World index, and build the thin per-op `Store` on it in backend-rs.

**Architecture:** `arke_entities(pid BIGSERIAL PK, version)`; component tables key on `pid`. World index is always ephemeral (`spawn()`, dense-local). `PgStore` maintains a `pid ↔ Entity` map per working set. Writes are two-phase (sync read World → owned; async DB) so handler futures stay `Send`. App `Store` is per-op & stateless.

**Repos:** arke-postgres in `/home/qyubit/Workspace/personal/rust-ecs/arke-postgres`; Store in `apps/backend-rs/crates/persistence`.

**RFC:** `rust-ecs/docs/RFC/RFC-0034-decoupled-persistent-id.md` (Accepted).

**Test Postgres:** `podman run -d --name arke-pid-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=arke_test -p 55432:5432 docker.io/library/postgres:17-alpine`; `ARKE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/arke_test`. Remove with `podman rm -f arke-pid-pg`. DB tests skip when unset.

---

## Part A — arke-postgres `0.12.0`

> Ordering keeps the crate compiling: Task 1 changes the schema + column helper, Tasks 2–3 rekey the write/read machinery, Task 4 the query builder, Task 5 the whole-world API + the `pid↔Entity` map, Task 6 the cache, Task 7 the release. Run `cargo check -p arke-postgres` after each.

### Task 1: Schema — `pid` key, drop `generation`

**Files:** `arke-postgres/src/store.rs` (`migrate`), `arke-postgres/src/lib.rs` (`create_table_sql_from` / `ColumnDef` PK column).

- [ ] **Step 1:** In `migrate`, replace the `arke_entities` DDL:
```sql
CREATE TABLE IF NOT EXISTS arke_entities (pid BIGSERIAL PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0)
```
Drop the `generation` column + the old `entity_id` PK. Remove the `generation` ALTER.
- [ ] **Step 2:** In `create_table_sql_from` (lib.rs), change the component-table key column from `entity_id BIGINT PRIMARY KEY REFERENCES arke_entities(entity_id)` to `pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE`. Update any `entity_id` literal in `insert_sql`/`select_sql`/DELETE fragments (store.rs) to `pid`.
- [ ] **Step 3:** `cargo check -p arke-postgres` — expect **errors** in save/load/materialize (they still use `entity_id`/`generation`); those are fixed in Tasks 2–5. Confirm the DDL/SQL-fragment code compiles in isolation (the string SQL won't error; type errors come from the Rust logic touched next). This task's "green" gate is Task 5's full compile — note that here and proceed.

### Task 2: `dump`/`apply` rekey to `Entity` (map-based)

**Files:** `arke-postgres/src/store.rs`

- [ ] **Step 1:** Change `type ComponentRow = (i64, Vec<PgValue>)` semantics from `(entity_id, ...)` to `(pid, ...)`, and change `dump` to yield the **Entity** (caller maps to pid):
```rust
struct Registered {
    // ...
    dump: fn(&World) -> Vec<(Entity, Vec<PgValue>)>,   // was Vec<(i64, ...)>
    dump_one: fn(&World, Entity) -> Option<Vec<PgValue>>, // unchanged
    apply: fn(&mut World, Entity, &[PgValue]),            // unchanged
}
fn dump_of<T: PgComponent + Component>(world: &World) -> Vec<(Entity, Vec<PgValue>)> {
    let mut out = Vec::new();
    <(Entity, &T)>::each_filtered_shared::<()>(world, |(e, c)| out.push((e, c.to_params())));
    out
}
```
- [ ] **Step 2:** Add the working-set map to `PgStore`:
```rust
pub struct PgStore {
    pool: PgPool,
    registered: Vec<Registered>,
    pid_of: HashMap<Entity, i64>,
    entity_of: HashMap<i64, Entity>,
    last: HashMap<i64, EntityState>,   // now keyed by pid
    cache: Option<Arc<dyn ComponentCache>>,
}
```
Init the two maps empty in `from_pool`. Add helpers `fn pid(&self, e: Entity) -> Option<i64>` and `fn bind(&mut self, pid: i64, e: Entity)` (insert both maps).
- [ ] **Step 3:** `cargo check` (still red in save/load — expected).

### Task 3: Per-op API — `insert` / `fetch` / `update` / `remove`

**Files:** `arke-postgres/src/store.rs`

- [ ] **Step 1: `insert`** (allocate pid + write components; two-phase):
```rust
/// Allocate a pid and persist `entity`'s registered components. Records the map.
pub async fn insert(&mut self, world: &World, entity: Entity) -> Result<i64, sqlx::Error> {
    // sync: gather this entity's component params (owned)
    let rows: Vec<(usize, Vec<PgValue>)> = self.registered.iter().enumerate()
        .filter_map(|(ci, r)| (r.dump_one)(world, entity).map(|p| (ci, p))).collect();
    // async: INSERT arke_entities RETURNING pid, then component rows keyed by pid
    let mut tx = self.pool.begin().await?;
    let pid: i64 = sqlx::query_scalar("INSERT INTO arke_entities (version) VALUES (0) RETURNING pid")
        .fetch_one(&mut *tx).await?;
    for (ci, params) in &rows {
        let r = &self.registered[*ci];
        let mut q = sqlx::query(&insert_sql(r)).bind(pid);
        for (v, col) in params.iter().zip(r.columns) { q = bind_value(q, col.ty, v); }
        q.execute(&mut *tx).await?;
    }
    tx.commit().await?;
    self.bind(pid, entity);
    Ok(pid)
}
```
(`insert_sql` already emits `INSERT INTO <table> (pid, cols...) VALUES (...)` after Task 1's `entity_id`→`pid` rename.)
- [ ] **Step 2: `fetch`** (materialize one pid → local entity):
```rust
pub async fn fetch(&mut self, world: &mut World, pid: i64) -> Result<Option<Entity>, sqlx::Error> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT pid FROM arke_entities WHERE pid = $1")
        .fetch_optional(&self.pool).await?;
    let Some(_) = exists else { return Ok(None) };
    let entity = world.spawn();                       // dense local index
    for r in &self.registered {
        let row = sqlx::query(&select_sql(r, Some("pid = $1"))).bind(pid)
            .fetch_optional(&self.pool).await?;
        if let Some(row) = row {
            let mut values = Vec::with_capacity(r.columns.len());
            for col in r.columns { values.push(read_value(&row, col)?); }
            (r.apply)(world, entity, &values);
        }
    }
    self.bind(pid, entity);
    Ok(Some(entity))
}
```
(Cache read-through can be added later; keep direct-Postgres per RFC-0034 §5 note + the cache task.)
- [ ] **Step 3: `update`** (rewrite one pid's components from `entity`, bump version):
```rust
pub async fn update(&mut self, world: &World, pid: i64, entity: Entity) -> Result<(), sqlx::Error> {
    let rows: Vec<(usize, Option<Vec<PgValue>>)> = self.registered.iter().enumerate()
        .map(|(ci, r)| (ci, (r.dump_one)(world, entity))).collect();
    let mut tx = self.pool.begin().await?;
    sqlx::query("UPDATE arke_entities SET version = version + 1 WHERE pid = $1").bind(pid).execute(&mut *tx).await?;
    for (ci, params) in &rows {
        let r = &self.registered[*ci];
        sqlx::query(&format!("DELETE FROM {} WHERE pid = $1", r.table)).bind(pid).execute(&mut *tx).await?;
        if let Some(params) = params {
            let mut q = sqlx::query(&insert_sql(r)).bind(pid);
            for (v, col) in params.iter().zip(r.columns) { q = bind_value(q, col.ty, v); }
            q.execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}
```
- [ ] **Step 4: `remove`**: `DELETE FROM arke_entities WHERE pid = $1` (cascade drops component rows).
- [ ] **Step 5: Integration test** (gated on `ARKE_TEST_DATABASE_URL`) in store.rs `#[cfg(test)]`: register a `Note`, `insert` → pid, `fetch` → asserts text, `update` → asserts new text, `remove` → `fetch` None. Run vs podman PG.

### Task 4: Query builder + `query_pids`

**Files:** `arke-postgres/src/store.rs`, `arke-postgres/src/query.rs`

- [ ] **Step 1:** Rekey `load_by_query`/`materialize` to pid: the query selects matching `pid`s; materialize spawns **local** entities (`world.spawn()`, not `spawn_at`), applies components, and records `self.bind(pid, entity)`. Return `Vec<(i64, Entity)>` (pid, entity) instead of a count — or add a sibling that does.
- [ ] **Step 2:** Add `query_pids`:
```rust
/// Load entities matching a typed query into `world`; return (pid, Entity) pairs.
pub async fn query_pids<T: PgComponent>(&mut self, world: &mut World, q: crate::Query<'_, T>)
    -> Result<Vec<(i64, Entity)>, sqlx::Error>
```
Implement via the query's SQL (`SELECT pid FROM cmp_T WHERE …`) → for each pid `fetch` into `world` → collect pairs.
- [ ] **Step 3: Test** — insert 2 Notes, `query_pids::<Note>` with/without filter, assert pids+texts. Run vs PG.

### Task 5: Whole-world API rekey (`save`/`load`/`save_incremental` + two-phase) via the map

**Files:** `arke-postgres/src/store.rs`

- [ ] **Step 1:** Rekey `load` (whole world): SELECT all pids; for each `spawn()` local + apply + `bind`. (No `spawn_at`; index is ephemeral.)
- [ ] **Step 2:** Rekey `dump_state`, `stage`/`commit`, `stage_incremental`/`commit_incremental`, `save`, `save_incremental` to key by **pid** (via `pid_of`): where they previously used `e.index() as i64`, use `self.pid_of[&e]` (allocate a pid for not-yet-persisted entities during `save`/`insert`). `update_entity`/`entity_version` rekey to `pid` + `version` (drop `generation`).
- [ ] **Step 3:** Fix arke-postgres's own examples/tests (`examples/persist.rs`, any `tests/`) to the new pid API (they used `entity.index()`/`spawn_at` assumptions). Keep them compiling & meaningful.
- [ ] **Step 4:** `cargo check -p arke-postgres` and `cargo test -p arke-postgres` (with `ARKE_TEST_DATABASE_URL`) — **all green**. This is the crate-wide compile gate for Tasks 1–5.

### Task 6: Cache keyed by `pid` (amends RFC-0033)

**Files:** `arke-postgres/src/store.rs`, `arke-postgres/src/cache.rs` (if keys are constructed there)

- [ ] **Step 1:** Update `ComponentCache` get/put/invalidate call sites to key by `pid` (they already take `&[i64]` ids — ensure those ids are pids, not indices). Add read-through in `fetch`/`query` if desired (optional; can stay direct-Postgres).
- [ ] **Step 2:** `cargo check`; commit.

### Task 7: Release `0.12.0`

**Files:** `arke-postgres/Cargo.toml`, `rust-ecs/CHANGELOG.md`

- [ ] **Step 1:** Bump `arke-postgres` version `0.11.0` → `0.12.0`. Add a CHANGELOG entry referencing RFC-0034 (breaking: pid key, dropped persisted generation).
- [ ] **Step 2:** Commit each task in `rust-ecs` as you go (`feat(arke-postgres): …`), final `chore(arke-postgres): release 0.12.0 (RFC-0034)`.

---

## Part B — backend-rs `Store` (per-op, pid)

### Task 8: Generic `Store` over the pid API

**Files:** `apps/backend-rs/crates/persistence/src/lib.rs`, `crates/persistence/Cargo.toml` (add `sqlx` workspace dep for `PgPool`; add `sqlx` to `[workspace.dependencies]` in `apps/backend-rs/Cargo.toml`)

- [ ] **Step 1:** Replace the heartbeat Store with the generic per-op Store:
```rust
pub struct Store { pool: PgPool, register: Arc<dyn Fn(&mut PgStore) + Send + Sync> }
impl Store {
    pub async fn connect(url: &str, register: impl Fn(&mut PgStore) + Send + Sync + 'static) -> Result<Self>;
    fn fresh(&self) -> PgStore;                       // from_pool + register
    pub async fn create<B: Bundle>(&self, bundle: B) -> Result<i64> {    // -> pid
        let mut pg = self.fresh(); let mut w = World::new();
        let e = w.spawn_bundle(bundle); pg.insert(&w, e).await.map_err(Into::into)
    }
    pub async fn get<T: PgComponent + Component + Clone>(&self, pid: i64) -> Result<Option<T>> {
        let mut pg = self.fresh(); let mut w = World::new();
        Ok(pg.fetch(&mut w, pid).await?.and_then(|e| w.get::<T>(e).cloned()))
    }
    pub async fn update(&self, pid: i64, mutate: impl FnOnce(&mut World, Entity)) -> Result<()> {
        let mut pg = self.fresh(); let mut w = World::new();
        if let Some(e) = pg.fetch(&mut w, pid).await? { mutate(&mut w, e); pg.update(&w, pid, e).await?; }
        Ok(())
    }
    pub async fn delete(&self, pid: i64) -> Result<()> { self.fresh().remove(pid).await.map_err(Into::into) }
    pub async fn query<T, R>(&self, build: …, map: impl FnOnce(&World) -> Vec<R>) -> Result<Vec<R>> { … query_pids … }
}
```
Send-safety holds: World is a per-op local (never shared, never held across await inside a shared guard); the pid API's writes are two-phase.
- [ ] **Step 2: Integration test** — create→get→update→get→delete→get(None), and a two-`create`+`query` test that now returns **both** entities (the bug that killed the arke-index approach). Run vs podman PG → **both distinct pids**.
- [ ] **Step 3: Commit** `feat(persistence): per-op pid Store (create/get/query/update/delete)`.

### Task 9: Rewire `DbCheck` + live e2e

**Files:** `crates/transport/src/lib.rs`, `crates/app/src/main.rs`

- [ ] **Step 1:** `Store::connect(url, |pg| pg.register::<HeartbeatAt>())` in `main`; `db_check` uses `create((HeartbeatAt{ts},))` + `get::<HeartbeatAt>(pid)`; `heartbeat_id = pid.to_string()`.
- [ ] **Step 2:** `cargo test` (workspace) green.
- [ ] **Step 3:** Live smoke — podman PG + boot + `curl DbCheck` ×2 (ts differ) + the frontend `smoke-connect.ts`. Stop server + `podman rm -f arke-pid-pg`.
- [ ] **Step 4: Commit** `feat: DbCheck via per-op pid Store`.

---

## Self-Review

**RFC coverage:** schema pid + drop generation (Task 1, 5); pid↔Entity map (Task 2); per-op API insert/fetch/update/remove (Task 3); query_pids (pid,Entity) (Task 4); whole-world rekey + two-phase (Task 5); cache by pid (Task 6); 0.12.0 (Task 7); app Store (Task 8–9).

**Placeholder scan:** The query-builder rekey (Task 4 Step 1) and whole-world rekey (Task 5) are described at approach-level (not line-by-line) because they touch many interlocking methods — each is bounded by a `cargo check`/`cargo test` gate. No vague TODOs; concrete SQL/signatures given for the new per-op API (the app's critical path).

**Type consistency:** `pid: i64` everywhere (DB `BIGSERIAL` → `i64`); `insert -> i64`, `fetch(&mut World, i64) -> Option<Entity>`, `update(&World, i64, Entity)`, `remove(i64)`, `query_pids -> Vec<(i64, Entity)>`; Store methods take/return `pid: i64`. `pid_of: HashMap<Entity,i64>` / `entity_of: HashMap<i64,Entity>` named consistently.
