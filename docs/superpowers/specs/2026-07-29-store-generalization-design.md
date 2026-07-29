# Fase 1: Store Generalization — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan:** Generalisasi `persistence::Store` dari skeleton (HeartbeatAt-only, full `save`) menjadi CRUD generik **per-operasi & stateless** di atas arke-postgres — plus ekstensi arke-postgres yang dibutuhkannya. Prasyarat Fase 2+ (Users, Project, dst.).
- **Terkait:** [Fondasi §5/§12](./2026-07-29-platform-foundation-design.md) · [Tech Stack](./2026-07-29-tech-stack-decisions.md) · [Urutan Implementasi](./2026-07-29-implementation-order.md)

---

## 1. Keputusan & Prinsip

- **Per-operasi, stateless.** Tiap operasi membuat `World` kecil + `PgStore` segar (berbagi pool), memuat hanya subset yang perlu, mutasi, persist, buang. **Postgres sumber kebenaran.** Tanpa World global in-memory.
- **Cache Redis (ComponentCache) ditunda** — baca/tulis langsung ke Postgres dulu; `with_cache` menyusul saat perlu skala baca.
- **Send-safe by construction.** Handler async multi-thread → future `Send`.

## 2. Prasyarat Send-safety (temuan)

| Operasi arke-postgres | Argumen World | Future `Send`? |
|---|---|---|
| `load` / `load_where::<T>` / `query::<T>().load` | `&mut World` | ✅ (`&mut World: Send` ⇐ `World: Send`, sudah difix) |
| `save(&World)` | `&World` (shared) | ✅ **via `stage`/`commit`** (sudah dibuat) |
| `save_incremental(&World)` | `&World` (shared) | ❌ butuh `World: Sync` — **perlu two-phase** |
| `update_entity(&World, …)` | `&World` (shared) | ❌ (idem; dipakai untuk optimistic — di luar cakupan awal) |

**Reads sudah aman.** Yang perlu: **two-phase untuk jalur incremental** (create/update/delete per-op memakai diff).

## 3. Ekstensi arke-postgres: two-phase incremental

Lanjutan pola `stage`/`commit`, diterapkan ke `save_incremental`:

```rust
/// Snapshot diff owned (sync) untuk commit async — hasil stage_incremental.
pub struct StagedIncremental { /* deletes: Vec<i64>, upserts: Vec<(id, gen, per-komponen params)>, next_state */ }

impl PgStore {
    /// Fase 1 (sync): diff `world` vs rekam sinkron internal → owned StagedIncremental
    /// (tanpa await, tak menahan &World).
    pub fn stage_incremental(&self, world: &World) -> StagedIncremental;

    /// Fase 2 (async): tulis diff (UPSERT versi-naik + DELETE hilang) dalam 1 transaksi,
    /// perbarui rekam sinkron + invalidate cache. Tak menyentuh World.
    pub async fn commit_incremental(&mut self, staged: StagedIncremental) -> Result<SyncStats, sqlx::Error>;

    // save_incremental(&World) tetap = stage_incremental + commit_incremental (backward-compat).
}
```

Logika mengikuti `save_incremental` yang ada (`dump_state` untuk `current`; deletes = di `last` tak di `current`; upserts = baru/berubah). `stage_incremental` menghitung `current` + diff (sync); `commit_incremental` menjalankan SQL (async). `commit`/`stage` (full) tetap ada untuk kasus overwrite penuh.

## 4. App `Store` (per-op, generik)

`persistence` crate:

```rust
pub struct Store {
    pool: PgPool,
    /// Mendaftarkan semua komponen aplikasi pada PgStore segar tiap operasi.
    register: Arc<dyn Fn(&mut PgStore) + Send + Sync>,
}

impl Store {
    pub async fn connect(url: &str, register: impl Fn(&mut PgStore) + Send + Sync + 'static) -> Result<Self>;
    /// Membangun PgStore segar (pool.clone() + register) — self.last scoped per-op.
    fn fresh(&self) -> PgStore;

    /// Buat entity dari bundle komponen; persist; kembalikan id (entity index).
    pub async fn create<B: Bundle>(&self, bundle: B) -> Result<u32>;
    /// Ambil satu komponen entity by id.
    pub async fn get<T: PgComponent + Component>(&self, id: u32) -> Result<Option<T>>;
    /// Muat entity yang cocok query typed (RFC-0030) → materialisasi + map.
    pub async fn query<T, R>(&self, build: impl FnOnce(Query<T>) -> Query<T>, map: impl Fn(&World) -> Vec<R>) -> Result<Vec<R>>;
    /// Muat entity id, jalankan mutator, persist (incremental).
    pub async fn update(&self, id: u32, mutate: impl FnOnce(&mut World, Entity)) -> Result<()>;
    /// Hapus entity by id (despawn + incremental commit).
    pub async fn delete(&self, id: u32) -> Result<()>;
}
```

- **create:** `let mut pg = self.fresh(); let mut w = World::new(); let e = w.spawn_bundle(bundle); let s = pg.stage_incremental(&w); pg.commit_incremental(s).await?; Ok(e.index())`.
- **get/query:** `let mut pg = self.fresh(); let mut w = World::new(); pg.load_where/query...(&mut w).await?; read from w`.
- **update/delete:** load subset → mutate/despawn → `stage_incremental`+`commit_incremental`.
- **Registrasi:** closure `register` mendaftarkan tiap tipe komponen aplikasi (flow menambah tipenya seiring waktu). Fase 1: minimal (mis. `HeartbeatAt`; komponen nyata masuk di flow-nya).
- **API pasti** (nama/generik) boleh disesuaikan saat implementasi selama menjaga: per-op, stateless, Send.

## 5. Skeleton → generik

- `HeartbeatAt` Store dua-lock diganti `Store` generik. `DbCheck` handler diubah memakai `create::<(HeartbeatAt,)>` + `get::<HeartbeatAt>` (atau tetap sbg smoke). Test integrasi diperbarui.
- Entity id di kontrak = **`entity.index()`** (u32) sebagai string; generation ditangani internal arke-postgres. (Catatan: proto memakai `string id` — mapping `id = index.to_string()`.)

## 6. Di Luar Cakupan

- **ComponentCache/Redis** (ditunda).
- **`update_entity` optimistic two-phase** (dipakai bila butuh optimistic-lock; belum diperlukan).
- **Multi-instance coherence / cache invalidation lintas-node.**
- Komponen domain nyata (User/Project) — milik flow masing-masing; Fase 1 hanya menyediakan mesin Store.

## 7. Keputusan Terbuka (usul)

1. **Bentuk `query` API** (closure builder+mapper vs mengembalikan World). — *Usul: builder+mapper agar World tak bocor keluar Store.*
2. **`create` menerima Bundle vs komponen individual.** — *Usul: Bundle (tuple), sesuai arke `spawn_bundle`.*
3. **Perlu `update_entity` optimistic** di Fase 1? — *Usul: tidak; incremental cukup.*
4. **ID publik: `entity.index()` u32** vs UUID lapisan atas. — *Usul: index dulu; UUID bila perlu id stabil lintas re-create.*
