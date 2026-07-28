# Kebijakan Testing — Re-Platform

- **Tanggal:** 2026-07-29
- **Status:** Keputusan
- **Cakupan:** Strategi & bar testing backend (Rust) + frontend (React) + CI. **Men-supersede** pendekatan `TEST_DATABASE_URL` di plan fondasi (kini **testcontainers**).
- **Terkait:** [Tech Stack](./2026-07-29-tech-stack-decisions.md) · [Foundation plan](../plans/2026-07-29-platform-foundation.md) · [Urutan Implementasi](./2026-07-29-implementation-order.md)

---

## 1. Filosofi

- **Piramida test:** banyak **unit** (domain murni) → **integration** (persistence & handler) → sedikit **e2e**.
- **TDD ketat untuk logika domain + guard** (area bug-rawan, high-value); **pragmatis** untuk glue/UI.
- **CI sejak fase 0** sebagai jaring pengaman.
- **Deterministik:** tanpa wall-clock/random di test — inject (jam/uuid via parameter), sesuai catatan plan fondasi.

## 2. Backend (Rust)

### 2.1 Unit — `cargo test` (`#[cfg(test)]`), **TDD wajib**
Area yang **harus** di-red-green:
- Parsing `Config`, sign/verify **JWT**, hash/verify **Argon2**, cek **permission**.
- **Mapper** proto ↔ domain; util **ordering**; aturan **`completed_at`**; validasi input.
- **Invarian** murni: satu owner, owner selalu member, assignee = member, phone unik, dst.

### 2.2 Integration — **testcontainers** (ephemeral Postgres)
- `testcontainers` + `testcontainers-modules` (postgres) → spin **Postgres sekali-pakai per run**. Hermetik, paralel-aman, tanpa polusi/DB lokal manual.
- Helper bersama `test_support`: `async fn pg() -> (ContainerAsync<Postgres>, Store)` — connect + reconcile skema.
- Uji: round-trip `arke-postgres` (save/load/reconcile), **invalidasi cache `Store`**, **scoping query** (membership), aturan **cascade** (delete module→tasks, delete media→links).
- Isolasi: container/skema segar per binari test → aman paralel.

### 2.3 Handler/RPC — `tower::ServiceExt::oneshot`
- Uji **enforcement guard** (member/owner/admin → `PERMISSION_DENIED`), **interceptor auth** (JWT valid/invalid/absen → `UNAUTHENTICATED`), happy-path tiap RPC.
- JWT di-mint in-test dgn `AUTH_JWT_SECRET`.

### 2.4 S3/Media
- Konstruksi **presigned URL** = unit (tanpa jaringan).
- Link/upload end-to-end = **testcontainers MinIO** (S3-compatible) saat flow media diimplementasi.

### 2.5 Bar wajib (backend)
1. **Setiap guard** di matriks otorisasi punya test (positif + negatif).
2. **Setiap invarian bisnis** punya test.
3. **Emit side-effect** (activity/notifikasi) minimal smoke (terpanggil saat mutasi).

## 3. Frontend (React)

### 3.1 Vitest + React Testing Library — **pragmatis**
- Setup: `vitest` + `@testing-library/react` + `jsdom`.
- **`api/` per-fitur:** uji `queryOptions`/mapper dgn **mock transport** connect `createRouterTransport` (tanpa jaringan).
- **Komponen:** interaksi form & visibilitas guard (mis. tombol owner tersembunyi utk member) dgn transport mock + `Provider` Jotai + `QueryClientProvider`.

### 3.2 Playwright — e2e jalur kritis
- Happy-path kecil & stabil: **login → dashboard**, **buat projek**, **buat task**, **tambah member**, **komentar + @mention**.
- Terhadap tumpukan jalan (backend-rs + FE) via docker-compose/dev. Selektor stabil `data-testid`.

### 3.3 Bar wajib (frontend)
- Mapper `api/` + alur auth + happy-path **buat projek** & **buat task**.

## 4. CI — GitHub Actions (sejak fase 0)

Workflow pada `push`/`pull_request`:

| Job | Langkah |
|---|---|
| **backend** | `cargo fmt --check` · `cargo clippy -D warnings` · `cargo test` (runner ber-Docker untuk testcontainers) |
| **proto** | `buf lint` (+ breaking-check vs `main`) |
| **frontend** | `bun run lint` · `bun run tsc --noEmit` · `vitest run` · `bun run build` |
| **e2e** | Playwright happy-path (job terpisah; boleh nightly bila memperlambat PR) |

- Cache `cargo` & `bun`. Runner CI wajib punya Docker (testcontainers + Playwright).

## 5. Konvensi

- **Kolokasi:** Rust unit inline `#[cfg(test)]`; integration di `crates/<x>/tests/`. FE `*.test.ts(x)` di samping sumber.
- **Tanpa flaky:** deterministik; tak bergantung urutan; tak ada `Date.now()`/random tak-terinject.
- **testcontainers & Playwright butuh Docker** di runner.

## 6. Ripple ke Plan Fondasi

- Plan fondasi Task 5 (Store integration) & Task 10 (e2e) semula memakai `TEST_DATABASE_URL` + skip-if-absent → **diganti `testcontainers`** (dok ini yang menang). Preliminaries plan diperbarui menandai ini.
- Task baru layak ditambah saat eksekusi: **helper `test_support::pg()`** + **workflow CI**.

## 7. Keputusan Terbuka (usul)

1. **MinIO container vs mock** untuk media. — *Usul: container saat flow media; mock untuk unit presign.*
2. **Playwright per-PR vs nightly.** — *Usul: happy-path kecil per-PR; skenario luas nightly.*
3. **Ambang coverage angka.** — *Usul: tak set angka keras; tegakkan "bar wajib" (§2.5, §3.3).*
4. **Snapshot test UI.** — *Usul: hindari snapshot rapuh; utamakan test interaksi/perilaku.*
