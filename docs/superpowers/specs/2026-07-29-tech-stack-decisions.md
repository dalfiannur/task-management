# Keputusan Tech Stack — Re-Platform

- **Tanggal:** 2026-07-29
- **Status:** Keputusan (sumber kebenaran stack)
- **Cakupan:** Daftar library/tool final untuk re-platform + rasional. **Men-supersede** setiap penyebutan Apollo / Zustand / React Router / pola hook-factory di dok flow — bila berbeda, **dok ini yang menang**.
- **Terkait:** [Fondasi](./2026-07-29-platform-foundation-design.md) · [Urutan Implementasi](./2026-07-29-implementation-order.md) · [`.proto` gabungan](../proto/sedjiwa_tasks.v1.proto)

---

## 1. Backend (Rust)

| Area | Library | Catatan |
|---|---|---|
| Async runtime | **`tokio`** | full features |
| Web + RPC | **`axum`** + **`connectrpc-axum`** (+ `connectrpc-axum-build`) | Connect + gRPC + gRPC-Web, satu handler |
| ECS | **`arke`** | archetype-based; **ID entity di-assign Arke** (app tak generate) |
| Persistensi | **`arke-postgres`** | Postgres = sumber kebenaran; **migrasi via reconcile**; `#[pg(index/unique)]` |
| DB | **PostgreSQL** | |
| JWT | **`jsonwebtoken`** | HS256, `AUTH_JWT_SECRET` |
| Password | **`argon2`** | Argon2id (PHC string) |
| Proto | **`prost`** | codegen via `connectrpc-axum-build` (buf) |
| Serde | **`serde`** / `serde_json` | |
| Errors | **`thiserror`** + **`anyhow`** | domain vs boundary |
| Waktu | **`time`** | RFC-3339 |
| Config | **`dotenvy`** + `Config` manual | env → struct, fail-fast |
| Storage S3 | **`rust-s3`** | presigned PUT/GET; RustFS/MinIO (endpoint + path-style) |
| Observability | **`tracing`** + **`tracing-subscriber`** | **sejak skeleton**: log terstruktur + span per-request (di interceptor) |

**Real-time:** Connect **server-streaming** (`StreamNotifications`). Fan-out multi-instance = **terbuka** (mulai in-process; `LISTEN/NOTIFY`/broker saat scale) — selaras keputusan cache fondasi.

## 2. Frontend (React) — keluarga TanStack + Jotai

| Area | Library | Menggantikan |
|---|---|---|
| Framework | **React 19** | — |
| Routing | **TanStack Router** | ~~React Router 7~~ |
| Data layer | **TanStack Query** via **`@connectrpc/connect-query`** | ~~Apollo Client~~ |
| Transport | **`@connectrpc/connect-web`** + `@connectrpc/connect` | — |
| Codegen | **`buf`** + **`@bufbuild/protoc-gen-es`** (v2) + `@bufbuild/protobuf` | ~~gql tagged templates~~ |
| State | **Jotai** (`atomWithStorage` utk persist) | ~~Zustand~~ |
| Styling | **Tailwind** + **shadcn/ui** (Radix) | — |
| Markdown | **`react-markdown` + `remark-gfm` + `rehype-sanitize`** | — (pages & comments; tanpa HTML mentah) |
| Drag & drop | **`dnd-kit`** | — (reorder all-tasks, drag timeline) |

**Dihapus:** `@apollo/client`, `zustand`, `react-router`, `src/stores/company-store.ts` (konsep company/sales dibuang).

### 2.1 Pola data-layer (menggantikan hook-factory)
- Query/mutation memakai **hook connect-query** (`useQuery`/`useMutation` per-RPC) → cache, invalidasi, refetch, optimistic ala TanStack. Deskripsi "hook `useXxx` → `{data, isLoading}`" di dok flow **dibaca sebagai** wrapper tipis di atas connect-query.
- **Streaming (`StreamNotifications`) BUKAN via connect-query.** Buka stream dengan **client Connect mentah** + kelola di effect/atom Jotai; fallback polling `UnreadCount` (TanStack Query).

### 2.2 Routing & auth (TanStack Router)
- Rute type-safe; **gating auth** via router `context` + `beforeLoad` (unauth → `/login?redirect=…`; rute admin → cek `isAdmin` dari atom auth).
- Nested route projek (`/$projectId/{all-tasks,timeline,members,pages,media}`) sebagai child routes dgn `<Outlet/>`.

### 2.3 State (Jotai)
- **Auth:** atom `{token, user, isAdmin}` dgn `atomWithStorage` (localStorage) → set header `Authorization` pada transport Connect saat berubah.
- **UI:** atom untuk sidebar, view-mode, zoom timeline (ganti `ui-store`).

## 3. Tooling & Testing

| Area | Pilihan |
|---|---|
| Backend build | Cargo **workspace** (`apps/backend-rs/crates/*`) |
| Proto codegen | **`buf`** (backend via `connectrpc-axum-build`, frontend via `protoc-gen-es`) |
| Backend test | `cargo test` + Postgres (`TEST_DATABASE_URL`, skip bersih bila absen) |
| Frontend test | belum dikonfigurasi (mengikuti status repo saat ini) |

## 4. Rasional Singkat

- **TanStack Router + Query + connect-query + Jotai** = satu keluarga koheren: routing & data-fetching type-safe end-to-end dari `.proto`, cache deklaratif, state atomik minimal-boilerplate. Menggantikan Apollo (cache GraphQL) yang tak relevan lagi pasca-gRPC.
- **`rust-s3`** dipilih (bukan `aws-sdk-s3`) demi kesederhanaan & dukungan RustFS/MinIO yang baik untuk kebutuhan presigned yang sempit.
- **ID di-assign Arke** menghindari duplikasi skema ID; handler tak generate ID.
- **`tracing` sejak awal** karena debugging tumpukan baru (Arke/Connect/S3) sangat terbantu span/log terstruktur.
- **`react-markdown` + sanitasi** aman-XSS untuk konten user (pages/comments), GFM untuk tabel/checklist.

## 5. Keputusan Terbuka (diwarisi)

Tak ada yang baru dari dok ini; yang lintas-flow tetap: **cache hasil-query**, **fan-out real-time multi-instance**, **generalisasi Store**, **migrasi data lama** — lihat [urutan implementasi §3](./2026-07-29-implementation-order.md#3-keputusan-terbuka-lintas-flow-terpusat).
