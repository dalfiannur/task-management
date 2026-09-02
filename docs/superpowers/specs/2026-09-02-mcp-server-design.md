# MCP Server (Personal Access Token) — Design

**Date:** 2026-09-02
**Status:** Approved (design)
**Scope:** v1 — jalur MCP sebagai fitur produk untuk user portal

## Ringkasan

Portal mengekspos sebuah **MCP server** di `POST /api/tasks-rs/mcp` sehingga tiap user
dapat menghubungkan AI client miliknya sendiri (Claude Desktop/Code, ChatGPT dev mode,
dsb.) ke akun portalnya. Autentikasi memakai **Personal Access Token (PAT)** yang
dibuat sendiri oleh user lewat halaman Settings.

AI client mendapat 12 tool untuk membaca dan mengubah task, menelusuri project/module,
mencari, melihat "my tasks", serta membaca dan menulis komentar.

## Keputusan Arsitektur

### 1. MCP hidup di dalam `backend-rs` (bukan service terpisah)

Crate baru `crates/mcp` dipasang pada axum router yang sama dengan seluruh Connect
service. Alasan: reuse langsung `domain`/`persistence`/`auth`, satu unit deploy, dan
tidak menghidupkan runtime kedua — padahal backend Bun justru sedang dipensiunkan.

### 2. Tool memanggil "core fn", bukan HTTP loopback

Kondisi awal: logika bisnis berada **di dalam handler axum**
(`async fn create_task(Extension(store), Option<Extension<AuthUser>>, ConnectRequest<..>)`),
private, tidak bisa dipanggil ulang.

Refactor: tiap handler yang dipakai MCP dipecah menjadi

```rust
pub(crate) async fn create_task_core(
    store: &Store,
    user: &AuthUser,
    req: pb::CreateTaskRequest,
) -> Result<pb::Task, ConnectError>
```

dan handler Connect menjadi pembungkus tipis. Core fn diekspor sebagai `transport::api::*`.

Konsekuensi: satu sumber kebenaran untuk validasi, member-gating, activity recording,
notifikasi, dan search indexing — MCP dan UI tidak mungkin berbeda perilaku.

**Alternatif yang ditolak:**
- *Loopback HTTP ke Connect API sendiri* — nol refactor, tapi server memanggil dirinya
  sendiri: hilang type-safety, auth diverifikasi dua kali, dan muncul ketergantungan
  konfigurasi base-URL yang rapuh di container.
- *MCP langsung ke `domain` + `persistence`* — menduplikasi validasi dan hampir pasti
  melewatkan activity/notification/search index.

### 3. PAT dikurung di endpoint MCP saja

`auth_layer` global tetap **JWT-only** persis seperti sekarang. Crate `mcp`
memverifikasi Bearer-nya sendiri dan **hanya menerima PAT** — JWT sesi browser ditolak di
endpoint MCP, PAT ditolak di seluruh Connect API. Dua jalur kredensial itu tidak pernah
bersinggungan, sehingga kalau PAT bocor blast radius-nya terbatas pada tool surface MCP.

### 4. Protokol ditulis tangan, bukan lewat SDK

Permukaan yang dilayani hanya `initialize`, `notifications/initialized`, `ping`,
`tools/list`, `tools/call` — sekitar 200 baris `serde_json`. Menarik SDK `rmcp` akan
mengikat proyek ke versi axum/tower miliknya tanpa imbalan setimpal.

## Arsitektur

Tiga lapis di `crates/mcp`:

1. **Lapis protokol** — JSON-RPC 2.0 di atas Streamable HTTP, **stateless** (tanpa
   `Mcp-Session-Id`; tiap request membawa PAT sendiri, jadi bebas diskalakan
   horizontal). `GET` (SSE) membalas `405` — v1 tidak punya pesan server-initiated.
2. **Lapis tool** — registry `&[Tool]`, tiap entry
   `{ name, description, input_schema: Value, handler }` dengan handler
   `async fn(&Store, &AuthUser, Value) -> Result<Value, ToolError>`. Handler memetakan
   JSON args → request proto, memanggil core fn, lalu memetakan hasilnya ke JSON pipih
   ramah-LLM (status jadi `"in_progress"`, bukan angka enum) — bukan proto JSON mentah.
3. **Lapis service** — `transport::api::*` (core fn dari keputusan #2).

## Model Data PAT

Bentuk token: `sjw_pat_<32 byte random, base64url>`.

Yang disimpan adalah **SHA-256 hex, bukan Argon2**. Entropi token sudah 256 bit sehingga
tidak ada risiko brute-force seperti password, sedangkan Argon2 akan menambah ~50–100 ms
pada *setiap* tool call. Kolom hash `#[pg(index, unique)]` → lookup O(1).

Komponen ECS baru di `crates/domain/src/token.rs`, mengikuti gaya fine-grained `user.rs`:

```rust
TokenSecret { #[pg(index, unique)] hash: String, preview: String }  // preview = 4 char terakhir
TokenOwner  { #[pg(index)] user_id: String }
TokenInfo   { name: String, created_at: String, expires_at: Option<String> }
TokenUsage  { last_used_at: Option<String> }
```

- **Revoke** = hapus entity.
- **`last_used_at`** di-update ter-throttle (hanya menulis bila catatan terakhir >1 jam),
  supaya tiap tool call tidak memicu write.
- **Permission** `AuthUser` diturunkan dari entity user pemiliknya (`AdminMark` → `*`),
  bukan snapshot beku di dalam token — jadi token otomatis kehilangan hak saat user
  di-suspend atau dicabut adminnya.

## Tool Surface (12 tool)

| Domain | Tool |
|---|---|
| Tasks | `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task` |
| Projects | `list_projects`, `get_project`, `list_modules` |
| Discovery | `search`, `my_tasks` |
| Comments | `list_comments`, `add_comment` |

Semuanya memakai core fn yang sama dengan UI, sehingga member-gating, validasi assignee,
activity record, notifikasi, dan search index otomatis ikut.

**`delete_task` sengaja tidak masuk v1.** Mode gagal terburuk dari agen AI adalah
menghapus kerjaan orang secara diam-diam, sementara `update_task` ke status batal/selesai
sudah menutup hampir semua kebutuhan nyata.

Filter `list_tasks` dipatok pada: `project_id`, `module_id`, `assignee_id`, `status`,
dan `limit` — semuanya opsional kecuali salah satu dari `project_id` atau `module_id`
harus ada, supaya tidak ada tool call yang memindai seluruh basis data.

**Bentuk respons dijaga hemat konteks:** list default `limit` 50 (maks 200), field
`description` dipotong pada 2.000 karakter dengan penanda, dan id selalu disertakan agar
model bisa melanjutkan ke `get_task`.

## Penanganan Error

Tiga jalur yang dibedakan:

| Kelas | Bentuk balasan |
|---|---|
| Kegagalan bisnis (`ConnectError` not-found / permission-denied / invalid-argument) | Tool result `isError: true` berisi kalimat yang bisa ditindaklanjuti model ("kamu bukan member project ini") |
| Kegagalan protokol (JSON rusak, method tak dikenal, params salah) | JSON-RPC error `-32700` / `-32601` / `-32602` |
| PAT hilang/salah/kedaluwarsa | **HTTP 401 + `WWW-Authenticate: Bearer`** — bukan error JSON-RPC, supaya client tahu ini soal kredensial |

## RPC Manajemen Token

`proto/tokens.proto` — service `AccessTokenService`, seluruhnya **self-scoped** (owner
selalu diambil dari JWT; admin pun tidak bisa melihat token milik orang lain):

- `CreateToken(name, expires_in_days)` → `{ token: string, meta: AccessToken }`
  — plaintext hanya ada di respons ini, tidak pernah bisa dibaca lagi.
  `expires_in_days = 0` berarti **tanpa kedaluwarsa** (`expires_at` kosong); nilai
  negatif ditolak `invalid_argument`. Token yang sudah lewat `expires_at` ditolak saat
  verifikasi tetapi **tidak** dihapus otomatis — ia tetap tampil di daftar dengan
  penanda kedaluwarsa sampai user me-revoke-nya.
- `ListTokens()` → `[AccessToken { id, name, preview, created_at, expires_at, last_used_at }]`
- `RevokeToken(id)` → `OkResponse`

## Frontend

Feature baru `src/features/tokens/` (`api/hooks.ts`, `api/mappers.ts`, `components/`,
`types.ts`, `index.ts`) dan route `src/routes/_authed/settings/tokens.tsx`, plus entri
navigasi di AppShell. Isi halaman:

- **Tabel token** — nama, `…a1b2`, dibuat, kedaluwarsa, terakhir dipakai, dan tombol
  Revoke lewat `AlertDialog` shadcn (bukan dialog browser)
- **Dialog pembuatan** — menampilkan plaintext sekali dengan tombol salin dan peringatan
  bahwa token tidak akan muncul lagi
- **Panel "Cara menyambungkan"** — URL endpoint dan snippet config siap-tempel. Panel ini
  yang membuat fiturnya benar-benar self-serve.

## Pengujian

Jaring pengaman utama untuk refactor core-fn: **seluruh `crates/transport/tests/*_flow.rs`
yang ada harus tetap hijau tanpa diubah.** Bila ada yang perlu disunting, itu tanda
ekstraksi core fn mengubah perilaku.

Di atas itu:

- `crates/domain` — unit test murni untuk format, hash, dan aturan expiry token
- `crates/transport/tests/tokens_flow.rs` — create/list/revoke dan isolasi antar-user
- `crates/mcp/tests/` — handshake `initialize`, `tools/list`, dan `tools/call`
  (jalur sukses, PAT kedaluwarsa, PAT tidak dikenal)

Gate frontend: `bun run tsc --noEmit`, `bun run lint`, `vite build`, dan `buf generate`
di kedua sisi setelah proto baru.

Catatan operasional: test backend membutuhkan env `DATABASE_URL` yang benar — tanpa itu
ia skip diam-diam — dan run pertama pada DB kosong selalu gagal sekali.

## Di Luar Cakupan v1

Diputuskan ditunda, bukan terlupakan:

- OAuth 2.1 + Dynamic Client Registration (dibutuhkan hanya bila ingin tampil sebagai
  Connector resmi di claude.ai / ChatGPT connectors)
- Primitive MCP `resources` dan `prompts`
- SSE / streaming dan pesan server-initiated
- `delete_task`
- Tool untuk pages, media, labels, notifications
- **Rate limiting per token** — risiko yang diketahui: sebuah PAT saat ini bisa
  memanggil tool tanpa batas
