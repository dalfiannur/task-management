# Flow: Tab Pages (Wiki Projek) — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Isi **tab pages** — wiki/dokumentasi per-projek berbasis **Markdown**: daftar halaman terurut, editor, CRUD, reorder. **Project-level saja** (tak ditautkan ke task/module).
- **Terkait:** [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [List & Detail-Shell](./2026-07-29-project-list-detail-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Tab pages = **wiki kolaboratif** milik satu projek. Halaman berisi teks **Markdown** dengan judul + ikon (emoji), diurutkan manual.

Keputusan yang membentuk desain:

- **Konten = Markdown** (string). Portable, ringan, mudah diff/migrasi; editor markdown + preview.
- **Project-level saja.** Halaman milik projek — **buang** `linkedTaskId`/`linkedModuleId` dan operasi `listPagesByTask`/`listPagesByModule`.
- **Kolaboratif:** **semua member** boleh create/edit/delete/reorder (konsisten dengan task).

## 2. Model Data — ECS Arke

| Komponen | Field | Semantik |
|---|---|---|
| `PageTag` | — | Penanda entity halaman. |
| `PageInfo` | `project_id: String` `#[pg(index)]`, `title: String`, `icon: String`, `content: String` (Markdown), `order: i32` `#[pg(index)]` | Isi & posisi halaman. |
| `PageAudit` | `created_by: String` `#[pg(index)]`, `last_edited_by: String`, `created_at: String` `#[pg(index)]`, `updated_at: String` | Jejak penulis/waktu. |

```rust
#[derive(Component)] struct PageTag;

#[derive(Component)]
struct PageInfo {
    #[pg(index)] project_id: String,
    title: String,
    icon: String,      // emoji, boleh kosong
    content: String,   // Markdown
    #[pg(index)] order: i32,
}

#[derive(Component)]
struct PageAudit {
    #[pg(index)] created_by: String,
    last_edited_by: String,
    #[pg(index)] created_at: String,
    updated_at: String,
}
```

- **Nama penulis tidak didenormalkan** (buang `createdByName`/`lastEditedByName` legacy). Frontend me-resolve nama dari direktori user via `useUser(id)` — sumber kebenaran tunggal.

## 3. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.page.v1;

service PageService {
  rpc ListPages(ListPagesRequest) returns (ListPagesResponse);
  rpc GetPage(GetPageRequest) returns (Page);
  rpc CreatePage(CreatePageRequest) returns (Page);
  rpc UpdatePage(UpdatePageRequest) returns (Page);
  rpc DeletePage(DeletePageRequest) returns (DeletePageResponse);
  rpc ReorderPages(ReorderPagesRequest) returns (ListPagesResponse);
}

message Page {
  string id = 1; string project_id = 2;
  string title = 3; string icon = 4; string content = 5; int32 order = 6;
  string created_by = 7; string last_edited_by = 8;
  string created_at = 9; string updated_at = 10;
}

message ListPagesRequest { string project_id = 1; }
message ListPagesResponse { repeated Page pages = 1; }
message GetPageRequest { string id = 1; }

message CreatePageRequest {
  string project_id = 1;
  optional string title = 2;   // default "Untitled"
  optional string icon = 3;
  optional string content = 4; // default ""
}
message UpdatePageRequest {
  string id = 1;
  optional string title = 2;
  optional string icon = 3;
  optional string content = 4;
}
message DeletePageRequest { string id = 1; }
message DeletePageResponse { bool ok = 1; }
message ReorderPagesRequest { string project_id = 1; repeated string page_ids = 2; }
```

## 4. Aturan & Guard

| Operasi | Siapa boleh | Aturan |
|---|---|---|
| `ListPages` / `GetPage` | member atau admin | Non-member → `PERMISSION_DENIED`. Diurut `order`. |
| `CreatePage` | **semua member** | Default `title="Untitled"`, `content=""`, `order` = paling belakang. `created_by`/`last_edited_by` = pemanggil; timestamps di-set. |
| `UpdatePage` | **semua member** | Field absen = tak diubah. `last_edited_by` = pemanggil, `updated_at` = now. |
| `DeletePage` | **semua member** | Menghapus halaman. |
| `ReorderPages` | **semua member** | Menata `order` sesuai `page_ids` (semua halaman projek). |

- **Validasi projek:** `CreatePage.project_id` harus projek tempat user jadi member. `Update/Delete/Reorder` menurunkan projek dari halaman untuk cek membership.
- **Side-effect (emit):** setelah mutasi sukses, emit **Activity** (`Page` · Created/Updated/Deleted) — lihat [Activity](./2026-07-29-activity-feed-flow-design.md) §5.

## 5. Frontend

Route sudah ada: `pages` (daftar) + `pages/:pageId` (editor). Migrasi CSS Module → **Tailwind** saat disentuh.

- **`pages-list.tsx`** — panel daftar halaman terurut (ikon + judul), tombol **New page**, **drag reorder** (`ReorderPages`), aksi hapus (konfirmasi). Klik → editor.
- **`page-editor.tsx`** — editor **Markdown** + preview, field **judul** & **ikon (emoji picker)**, jejak "Last edited by {nama} · {waktu}" (resolve `useUser`).
  - **Autosave** debounced saat mengetik → `UpdatePage` (optimistik). Alternatif: tombol Save eksplisit (keputusan §7).
- **Empty states:** projek tanpa halaman → ajakan "Create your first page" (semua member). 
- **Hooks (Connect):** `usePages`, `useGetPage`, `useCreatePage`, `useUpdatePage`, `useDeletePage`, `useReorderPages`. Mengembalikan tipe flat `Page`.
- **Rendering Markdown:** pakai renderer yang aman (sanitasi) untuk preview.

## 6. Di Luar Cakupan

- **Link halaman ke task/module** (dibuang).
- **Nested pages / hierarki**, tag, pencarian full-text.
- **Version history / revisi**, komentar pada halaman.
- **Kolaborasi real-time** (multi-kursor), embed media kaya.
- **Ekspor** (PDF/print).

## 7. Keputusan Terbuka (usul)

1. **Autosave vs Save eksplisit.** — *Usul: autosave debounced (mis. 800ms) + indikator "Saved"; lebih nyaman untuk wiki.*
2. **Pustaka editor Markdown** (mis. textarea + preview vs editor markdown WYSIWYG ringan). — *Usul: mulai editor markdown sederhana + preview; upgrade bila perlu.*
3. **Sanitasi/flavor Markdown** (GFM, izinkan HTML mentah?). — *Usul: GFM, HTML mentah dinonaktifkan demi keamanan.*
4. **Konkurensi edit** (dua member edit bareng) — *last-write-wins dulu; version history di luar cakupan.*
