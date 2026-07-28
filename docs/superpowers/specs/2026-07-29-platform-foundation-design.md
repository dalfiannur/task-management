# Fondasi Platform — Walking Skeleton (Desain)

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** *Walking skeleton* backend baru — membuktikan tumpukan **Rust + Arke (hybrid cache) + arke-postgres + Connect (Axum) + interceptor auth** jalan end-to-end. **Bukan** port fitur. Auth/login, permissions penuh, Membership, dan semua flow domain = dokumen terpisah.
- **Terkait:** [Flow Pertama: Membuat Projek Baru](./2026-07-29-create-project-flow-design.md) — flow itu terblokir sampai fondasi ini ada.

---

## 1. Tujuan & Prinsip

Backend task-management ditulis ulang **total (big-bang)** dari Bun/`bunsane` + GraphQL menjadi **Rust + Arke + gRPC/Connect**. Karena penggantian total berisiko besar bila dikerjakan sekaligus, langkah pertama adalah **walking skeleton**: satu binary Rust yang membuktikan setiap lapis target saling menyambung, sebelum satu pun flow bisnis diport.

Prinsip:

1. **Buktikan tumpukan, bukan fitur.** Skeleton berhasil jika sebuah RPC bisa: dilayani via Connect, diverifikasi auth-nya, lalu membaca/menulis entity lewat Arke↔Postgres.
2. **Seams jelas sejak awal.** Batas antar-lapis (transport / domain / persistence / auth) dikunci sebagai crate terpisah supaya penambahan flow berikutnya rapi.
3. **Mulai sederhana (YAGNI).** Hybrid cache dimulai single-instance dengan invalidasi-saat-write; koherensi multi-instance ditunda.
4. **Kompatibel dengan frontend saat ini di titik auth.** Kontrak JWT dipertahankan agar token yang sudah ada tetap valid.
5. **Big-bang bertahap, bukan cutover mendadak.** Target akhir mengganti Bun total, tapi selama dibangun backend-rs **hidup berdampingan** dengan Bun (lihat §2.1) — Bun tetap melayani semua flow lama sampai satu per satu diport, baru port `:3000` ditukar.

## 2. Platform Target

| Lapis | Legacy | Target (skeleton ini) |
|---|---|---|
| Runtime | Bun | **Rust** |
| Web/RPC | GraphQL (Apollo Yoga) | **Axum + `connectrpc-axum`** (Connect + gRPC + gRPC-Web dalam satu handler) |
| ECS | `bunsane` | **Arke** (`arke` crate) |
| Persistensi | bunsane→Postgres | **`arke-postgres`** (Postgres = sumber kebenaran kolom-tipe) + lapisan **cache in-memory (World)** |
| Auth | `AuthPlugin` (GraphQL context) | **Interceptor Tower** (verifikasi JWT HS256) |
| Observability | — | **`tracing`** + `tracing-subscriber` (sejak skeleton) |
| Client browser | Apollo Client | **`@connectrpc/connect-web`** (+ TanStack Router/Query, Jotai — [tech-stack](./2026-07-29-tech-stack-decisions.md)) |

> Sintaks Arke/arke-postgres/connectrpc-axum di dok ini memakai bentuk idiomatik dari dokumentasi masing-masing crate; bentuk final mengikuti versi terpakai. Sesuaikan saat implementasi.

### 2.1 Koeksistensi selama transisi

Selama porting, backend-rs **tidak** merebut endpoint Bun:

- **Port terpisah:** backend-rs listen di **`:3010`** (Bun tetap `:3000`, frontend dev tetap `:3001`).
- **Prefix terpisah:** frontend memanggil backend-rs lewat **`/api/tasks-rs`** (proxy dev → `:3010`), sementara `/api/tasks` (GraphQL Bun) tetap utuh.
- **DB bersama, tabel terpisah:** keduanya memakai instance Postgres yang sama (`sedjiwa_tasks`), tapi arke-postgres menulis ke tabel-tabelnya sendiri — tidak menyentuh tabel Bun.
- **Cutover:** setelah semua flow diport, `/api/tasks` diarahkan ke backend-rs (dan `:3000`↔`:3010` ditukar), lalu Bun dimatikan. Cutover = di luar cakupan skeleton.

## 3. Struktur Workspace

Cargo **workspace** di `apps/backend-rs/`:

```
apps/backend-rs/
├── Cargo.toml            # [workspace] members = crates/*
├── proto/
│   └── health.proto      # sumber kebenaran kontrak RPC skeleton
├── crates/
│   ├── app/              # bin utama: baca Config, boot Postgres, rekonsiliasi skema,
│   │                     #   bangun Store, rakit router Axum + interceptor, listen
│   ├── transport/        # kode ter-generate dari .proto + impl handler Connect (Health)
│   ├── domain/           # komponen ECS + logika. Skeleton: hanya komponen Heartbeat
│   ├── persistence/      # `Store`: pembungkus arke + arke-postgres + cache/invalidasi
│   └── auth/             # verifikasi JWT, tipe `AuthUser`, interceptor Tower
└── .env.example
```

**Tanggung jawab tiap crate (satu tujuan jelas):**

- `app` — hanya *wiring* & konfigurasi; tak berisi logika domain.
- `transport` — pemetaan pesan proto ↔ tipe domain + handler RPC. Tak menyentuh DB langsung (lewat `persistence`).
- `domain` — definisi komponen ECS & aturan; tak tahu soal HTTP/Postgres.
- `persistence` — satu-satunya yang tahu arke-postgres & cache.
- `auth` — satu-satunya yang tahu format & verifikasi JWT.

## 4. Konfigurasi & Boot

`Config` dibaca dari environment (via `dotenvy`):

| Env | Wajib | Default | Guna |
|---|---|---|---|
| `DATABASE_URL` | ya | — | koneksi Postgres |
| `AUTH_JWT_SECRET` | ya | — | kunci verifikasi JWT (HS256) |
| `AUTH_JWT_EXPIRES_IN` | tidak | `7d` | (untuk paritas; belum dipakai di skeleton karena tak ada login) |
| `PORT` | tidak | `3010` | port HTTP (terpisah dari Bun `:3000` selama transisi — lihat §2.1) |
| `CORS_ORIGINS` | tidak | `http://localhost:3001` | daftar origin diizinkan (dipisah koma) |

Boot (`app`):
1. Load `Config` (gagal cepat bila `AUTH_JWT_SECRET`/`DATABASE_URL` kosong).
2. Buka pool Postgres.
3. Rekonsiliasi skema arke-postgres untuk komponen `HeartbeatAt`.
4. Bangun `Store` (pool + cache).
5. Rakit router Axum: daftarkan service Connect dari `transport`, pasang interceptor auth (`auth`) dan CORS.
6. `listen` di `PORT`.

## 5. Persistensi & Runtime World (hybrid cache)

`persistence::Store` adalah satu-satunya jalur ke data:

```
Store {
    pg:    arke_postgres pool,   // sumber kebenaran
    cache: World (in-memory),    // cache; boleh diinvalidasi
}
```

- **Read `get<T>(key)`** → cek `cache`; jika miss → `load_where::<T>` dari Postgres → isi `cache` → kembalikan.
- **Write `put(entity, components)`** → `save`/`save_incremental` ke Postgres → **invalidasi** entri cache untuk entity itu.
- **Konsistensi:** Postgres selalu sumber kebenaran. Cache hanya akselerator baca; setiap write meng-invalidasi sebelum sukses dikembalikan.
- **Batas skeleton (klaim jujur):** skeleton **hanya** membuktikan jalur **tulis → invalidasi → baca-ulang untuk satu entity by-id**. Ia **tidak** membuktikan bagian tersulit dari hybrid cache: **caching hasil query** (mis. `list projek by-membership`) dan **invalidasi silang** (satu write yang harus meng-invalidasi banyak hasil query). Desain itu adalah **keputusan terbuka** (lihat §12) yang dikerjakan saat flow list projek — bukan di skeleton.
- **Batas lain:** cache **single-instance**, invalidasi = **buang entri saat write**. Koherensi antar-instance (mis. beberapa pod) **di luar cakupan** (opsi masa depan: LISTEN/NOTIFY Postgres, TTL, atau matikan cache).
- **Generalisasi (utang teknis):** di skeleton, `Store` cukup melayani satu komponen (`HeartbeatAt`). Sebelum flow nyata (create/list projek), `Store` **wajib digeneralisasi** menjadi API `get<T>`/`put<T>` lintas-komponen. Utang ini dicatat eksplisit agar tak jadi kejutan.

## 6. Transport Connect (Axum + connectrpc-axum)

- Kontrak di `proto/health.proto`.
- Codegen backend: `prost` + `connectrpc-axum` (via **`buf`**) menghasilkan tipe pesan + trait service; handler diimplementasikan di `transport`.
- Codegen frontend: `buf generate` → `@connectrpc/connect-web` (client TS).
- Satu router Axum menyajikan protokol **Connect** (HTTP/1.1 + JSON, mudah didebug) sekaligus **gRPC-Web**. Header `Authorization` & CORS diizinkan sesuai `Config`.

## 7. Kontrak RPC Skeleton

```proto
syntax = "proto3";
package sedjiwa.tasks.health.v1;

service HealthService {
  rpc Check(CheckRequest) returns (CheckResponse);       // tanpa auth, tanpa DB
  rpc DbCheck(DbCheckRequest) returns (DbCheckResponse); // buktikan Arke+Postgres+cache
  rpc WhoAmI(WhoAmIRequest) returns (WhoAmIResponse);    // ber-guard auth
}

message CheckRequest {}
message CheckResponse { string status = 1; } // "ok"

message DbCheckRequest {}
message DbCheckResponse {
  string heartbeat_id = 1;
  string ts = 2; // ISO-8601 dari entity yang baru ditulis lalu dibaca ulang
}

message WhoAmIRequest {}
message WhoAmIResponse { string user_id = 1; }
```

**Perilaku:**
- `Check` — liveness murni → `{ status: "ok" }`.
- `DbCheck` — `Store.put` satu entity `Heartbeat` (`HeartbeatAt { ts: now }`) → invalidasi → `Store.get` ulang dari sumber kebenaran → kembalikan `id` + `ts`. Membuktikan tulis, invalidasi, dan baca-ulang bukan dari cache basi.
- `WhoAmI` — memerlukan JWT valid; kembalikan `user_id` dari `AuthUser` yang diisi interceptor. Tanpa/invalid token → error `UNAUTHENTICATED`.

Komponen domain skeleton:

```rust
// crates/domain
#[derive(Component)]
struct HeartbeatAt { ts: String } // ISO-8601
```

## 8. Auth Interceptor

Di `crates/auth`:
- Middleware Tower membaca header `Authorization: Bearer <jwt>`.
- Verifikasi HS256 dengan `AUTH_JWT_SECRET` memakai crate `jsonwebtoken`.
- Klaim dipetakan ke `AuthUser { id: String, permissions: Vec<String> }` (admin membawa `["*"]`) — paritas dengan `src/auth/types.ts` sekarang.
- `AuthUser` disimpan ke request extension; handler ber-guard mengambilnya. Absen/invalid pada RPC ber-guard → `UNAUTHENTICATED`.
- **Kontrak JWT tidak berubah** dari implementasi Bun → token yang sudah dipegang frontend tetap diterima.

## 9. Skema & Migrasi

- arke-postgres merekonsiliasi kolom untuk komponen `HeartbeatAt` saat boot (kolom bertipe; atribut `#[pg(...)]` bila perlu).
- Belum ada tabel Project/Task/dst. — itu milik flow masing-masing.

## 10. Kriteria Selesai (acceptance)

Skeleton dianggap selesai bila **semua** berikut terbukti:

1. `cargo run -p app` boot tanpa error dan terhubung ke Postgres.
2. Panggilan `HealthService.Check` (via `curl` protokol Connect atau connect-web) → `{ "status": "ok" }`.
3. `HealthService.DbCheck` dipanggil dua kali berturut → `ts` berbeda dan nilainya sama dengan yang tersimpan di Postgres (mis. dicek via `psql`), membuktikan baca-ulang bukan cache basi.
4. `HealthService.WhoAmI`:
   - dengan JWT valid (di-mint pakai `AUTH_JWT_SECRET`) → `{ user_id }` benar;
   - tanpa token / token invalid → `UNAUTHENTICATED`.
5. Frontend: transport `connect-web` + interceptor auth minimal berhasil memanggil `WhoAmI` memakai token dari `useAuthStore`.

## 11. Di Luar Cakupan

- Auth/login penuh (register/login/me), model permissions & guards lengkap, Membership. → didefinisikan di [Users & Auth](./2026-07-29-users-auth-flow-design.md).
- Semua flow domain (Project, Task, dst.) dan migrasi data lama dari Core/Bun.
- Koherensi cache antar-instance (multi-node).
- Observability/logging/metrics lanjutan (skeleton cukup log dasar).

## 12. Keputusan Terbuka (usul)

1. **Lokasi:** `apps/backend-rs/` di monorepo yang sama. — *Usul: ya (bukan repo terpisah).*
2. **Codegen proto:** `buf`. — *Usul: ya.*
3. **Pemisahan crate `domain`/`transport`** sejak skeleton. — *Usul: pisah, agar batas terkunci lebih awal.*
4. **Strategi invalidasi cache lanjutan** (LISTEN/NOTIFY vs TTL vs no-cache) sebelum scale horizontal. — *Ditunda; diputuskan saat kebutuhan multi-instance muncul.*
5. **Desain caching hasil query + invalidasi silang** (bagian tersulit hybrid cache, lihat §5). — *Terbuka; diputuskan & diuji saat flow list projek, bukan di skeleton.*
6. **Kapan & bagaimana `Store` digeneralisasi** dari single-component ke `get<T>`/`put<T>`. — *Usul: tepat sebelum flow create-project, sebagai task pertama flow itu.*

## 13. Risiko Utama

1. **🔴 Ketergantungan pada `arke` / `arke-postgres` yang muda.** Seluruh platform bersandar pada crate internal versi `0.6` (ekosistem kecil, API mungkin masih berubah, dokumentasi terbatas). Jika sebuah kebutuhan (mis. query builder, migrasi, tipe kolom) belum didukung, ia bisa memblokir fondasi.
   - **Mitigasi:** jadikan **Task 4–5 (komponen + Store/arke-postgres) sebagai spike de-risking paling awal** — buktikan persist/load/reconcile jalan sebelum membangun transport & app di atasnya. Bila ada gap API, itu keputusan `arke` (yang kita kontrol sebagai penulisnya) atau fallback (mis. SQL langsung untuk kasus yang belum didukung).
2. **🟡 Kematangan `connectrpc-axum` (`0.2`) & kompatibilitas versi `axum`.** Codegen & bentuk service-impl bisa berbeda dari asumsi dok.
   - **Mitigasi:** Task 6–7 wajib membuka contoh crate lebih dulu; gate compile menangkap ketidakcocokan.
3. **🟡 Hybrid cache menunda kompleksitas, bukan menghilangkannya.** Bagian tersulit (query-cache + invalidasi silang) sengaja ditunda (§5, §12). Risiko: keputusan itu ternyata memaksa perubahan bentuk `Store`.
   - **Mitigasi:** desain `Store::get<T>`/`put<T>` sejak generalisasi (§12 no.6) dengan ruang untuk lapisan query-cache, agar penambahan nanti aditif.
