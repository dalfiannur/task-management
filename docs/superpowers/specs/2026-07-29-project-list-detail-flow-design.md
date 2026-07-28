# Flow: List & Detail-Shell Projek — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** (a) **Halaman List** projek + (b) **Shell Detail** (header projek + navigasi tab + baca 1 projek + aksi otoritas owner). **Isi tiap tab** (all-tasks/timeline/members/media/pages) = dokumen flow masing-masing.
- **Terkait:** [Fondasi Platform](./2026-07-29-platform-foundation-design.md) · [Flow Membuat Projek](./2026-07-29-create-project-flow-design.md)

---

## 1. Ringkasan & Prinsip

Model **delivery murni**, **tanpa sub-project** (Project → Modules → Tasks), dengan **owner tunggal + otoritas** (lihat dok create). Dok ini merancang **cara projek dibaca & dinavigasi**, bukan isi tiap tab.

- Sumber data = backend lokal (Connect `ProjectService`), bukan Core Portal.
- Semua konsep sales lama (company owner, tipe internal/leads/commercial, winStage, "New Leads") **dibuang** dari UI.
- List **flat** & **member-scoped**; detail **member-gated**; aksi mutasi **owner/admin-gated**.

## 2. Halaman List (`projects.tsx` — ditulis ulang)

### 2.1 Cakupan & data
- Menampilkan projek yang user **jadi member**-nya; **admin** (`*`) melihat semua.
- Flat (tak ada hierarki sub-project).

### 2.2 Kontrol
- **Filter status:** segmented **Active (default) / Completed / Archived / All**.
- **Search nama:** server-side (`ListProjectsRequest.search`), konsisten dengan pagination.
- **Pagination:** 12 / halaman (`page`/`limit`), plus `total` dari server.
- Tombol **Create** → membuka dialog create (dok create).

### 2.3 Card projek
Menampilkan: **nama**, **badge status**, **owner** (avatar + nama), **jumlah member**, **tanggal** (start–end bila ada). *(Progress/among task = ditambah saat flow tasks; tidak di sini.)*

### 2.4 State
- **Loading:** skeleton cards.
- **Empty:** pesan + tombol Create (mis. "Belum ada projek. Buat yang pertama.").
- Klik card → `/projects/{id}`.

### 2.5 Dibuang total
Panel "New Leads", `ApproveLeadDialog`, filter company/`ownerId`, tipe `internal|leads|commercial`, `winStage`, dan cabang query terkait.

## 3. Shell Detail (`project-layout.tsx` — dirampingkan)

### 3.1 Header
- **Kiri:** nama projek, badge status, owner (avatar+nama), tanggal (start–end), tumpukan avatar members.
- **Kanan (aksi, owner/admin):** ubah status (Active→Completed→Archived), **transfer ownership**, **hapus projek**. Non-owner non-admin: aksi tersembunyi/disable.
- **Dihapus:** breadcrumb induk & dropdown "link module" (artefak sub-project).

### 3.2 Navigasi tab
`all-tasks` (default) · `timeline` · `members` · `media` · `pages`. Tab **sub-projects dihapus**. `<Outlet/>` merender isi tab (didefinisikan dokumen lain). Tab aktif dihitung dari `pathname`.

### 3.3 Guard
- Non-member (dan bukan admin) membuka `/projects/{id}` → tampilan **akses ditolak** (backend `GetProject` mengembalikan `PERMISSION_DENIED`).

## 4. Kontrak Backend (domain + Connect)

Menambah operasi ke `ProjectService` yang sama:

```proto
service ProjectService {
  // CreateProject — dok create
  rpc ListProjects(ListProjectsRequest) returns (ListProjectsResponse);
  rpc GetProject(GetProjectRequest) returns (Project);

  // Aksi otoritas owner yang di-surface shell detail:
  rpc SetProjectStatus(SetProjectStatusRequest) returns (Project);
  rpc TransferProjectOwnership(TransferProjectOwnershipRequest) returns (Project);
  rpc DeleteProject(DeleteProjectRequest) returns (DeleteProjectResponse);
}

message ListProjectsRequest {
  repeated ProjectStatus status = 1; // kosong = semua status
  optional string search = 2;
  uint32 page = 3;   // 1-based; 0/absen → 1
  uint32 limit = 4;  // default 12
}
message ListProjectsResponse {
  repeated Project projects = 1;
  uint32 total = 2; // total setelah filter (untuk pagination)
}

message GetProjectRequest { string id = 1; }

message SetProjectStatusRequest { string id = 1; ProjectStatus status = 2; }
message TransferProjectOwnershipRequest { string id = 1; string new_owner_id = 2; }
message DeleteProjectRequest { string id = 1; }
message DeleteProjectResponse { bool ok = 1; }
```

`Project` = bentuk flat dari dok create (`id, name, description?, status, owner_id, start_date?, end_date?`).

### 4.1 Aturan operasi
- **`ListProjects` — member-scoped.** Server menyaring by keanggotaan dari `AuthUser`; admin (`*`) melihat semua. Filter `status`/`search` diterapkan di server; hasil dipaginasi; `total` = jumlah setelah filter.
- **`GetProject` — member-gated.** Non-member & non-admin → `PERMISSION_DENIED`. Tidak ada → `NOT_FOUND`.
- **`SetProjectStatus` / `TransferProjectOwnership` / `DeleteProject` — owner/admin-gated.** Selain owner atau admin → `PERMISSION_DENIED`. `TransferProjectOwnership` juga memastikan `new_owner_id` jadi member (auto-add bila belum) dan memindah `ProjectOwnerId`. `DeleteProject` menghapus entity projek beserta turunannya (modules/tasks/…); cakupan cascade detail = flow terkait.

## 5. Otoritas & Guard (ringkas)

| Aksi | Siapa |
|---|---|
| Lihat di List | member (admin: semua) |
| Buka Detail (`GetProject`) | member atau admin |
| Ubah status | owner atau admin |
| Transfer ownership | owner atau admin |
| Hapus projek | owner atau admin |
| Kelola member | owner atau admin *(kontrak di flow tab Members)* |

> Pergeseran dari legacy: dulu delete = **admin-only**; kini **owner atau admin**. Definisi permission formal (`Projects.*`) milik dok auth/permissions; dok ini mematok matriks perilakunya.

## 6. Cache (menyentuh titik terbuka fondasi)

`ListProjects` = query by-membership → inilah kasus **cache hasil-query** yang di fondasi ditandai terbuka ([fondasi §12 no.5](./2026-07-29-platform-foundation-design.md)). **Usul mulai sederhana:** List **read-through langsung ke Postgres tanpa cache hasil-query** dulu (benar & sederhana); cache ditambah belakangan bila perlu. Prasyarat: **generalisasi `Store`** (`get<T>`/`put<T>`, fondasi §12 no.6).

## 7. Frontend

- **`projects.tsx`** ditulis ulang: buang sales/leads/company/type/winStage; tambah segmented status + search + pagination + cards baru.
- **`project-layout.tsx`** dirampingkan: buang tab sub-projects & UI link-module & breadcrumb induk; tambah aksi owner (status/transfer/delete) dengan guard.
- **Hooks:** `useProjects`/`useProject` → Connect `ListProjects`/`GetProject` (tipe flat `Project`). Tambah `useSetProjectStatus`/`useTransferOwnership`/`useDeleteProject`. **Hapus** `useSubProjects`/`useLocalSubProjects`/`useCreateSubProject` dan sisa jalur Core Portal untuk projek.
- **Status config:** `PROJECT_STATUS_CONFIG` disederhanakan jadi 3 (Active/Completed/Archived); `getDisplayStatus` (turunan winStage) dihapus.
- **Owner UI:** tampilkan owner via `UserCombobox`/avatar; transfer ownership = pilih member lain sebagai owner baru.

## 8. Di Luar Cakupan

- Isi tiap tab (tasks/modules, timeline, members internals, media, pages).
- Flow **edit field** projek (nama/deskripsi/tanggal) — hanya status/owner/delete yang di-surface shell.
- Sub-project (dihapus dari model).
- Migrasi data projek Core lama.
- Cache hasil-query untuk List (ditunda, §6).

## 9. Keputusan Terbuka (usul)

1. **`SetProjectStatus` khusus vs `UpdateProject` umum.** — *Usul: operasi status khusus sekarang; edit field lain saat flow update.*
2. **Search server-side.** — *Usul: ya (sejalan pagination).*
3. **List tanpa cache dulu.** — *Usul: ya (§6).*
4. **Konfirmasi hapus & efek cascade** (apa yang ikut terhapus) — *perlu diselaraskan dengan flow tasks/modules.*
