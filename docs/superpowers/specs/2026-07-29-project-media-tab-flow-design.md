# Flow: Tab Media (File Manager) — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Isi **tab media** — file manager per-projek: unggah (presigned S3), daftar, unduh, hapus, dan **tautkan file ke task**. Media **di-fold ke backend Rust** (service media terpisah dibuang).
- **Terkait:** [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [List & Detail-Shell](./2026-07-29-project-list-detail-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Tab media = **file manager projek**. Perubahan arsitektur besar dari legacy:

- **Konsolidasi ke backend Rust.** MediaFileInfo disimpan **lokal**; unggah langsung ke **S3/RustFS**. **Service media terpisah (`/api/media`) dibuang** — tak ada lagi `useResolveMediaProjectId`/cross-service.
- **Unggah via presigned URL.** Backend menerbitkan presigned **PUT**; browser mengunggah **langsung** ke S3 (hemat bandwidth backend, cocok file besar). Unduh via presigned **GET** ber-TTL pendek.
- **Datar & member-scoped.** File milik **projek** (tanpa folder/module, tanpa sub-project). Semua **member** projek melihatnya — **visibility private/shared dibuang**.
- **Attach ke task** disertakan (many-to-many via `TaskMediaLink`).

## 2. Model Data — ECS Arke

### 2.1 File

| Komponen | Field | Semantik |
|---|---|---|
| `MediaFileTag` | — | Penanda entity file. |
| `MediaFileInfo` | `project_id: String` `#[pg(index)]`, `file_name: String`, `original_file_name: String`, `mime_type: String` `#[pg(index)]`, `size: i64`, `storage_key: String`, `uploaded_by: String` `#[pg(index)]`, `created_at: String` `#[pg(index)]`, `status: MediaStatus` | Metadata file. |
| `MediaStatus` (enum) | `{ Pending, Ready }` | `Pending` = row dibuat, byte belum dikonfirmasi; `Ready` = selesai (§3). |

*(Dihapus dari legacy: `url` (dibuat on-demand), `visibility`, `taskId` (pakai `TaskMediaLink`).)*

### 2.2 Link ke Task

| Komponen | Field | Semantik |
|---|---|---|
| `TaskMediaLinkTag` | — | Penanda entity link. |
| `TaskMediaLinkData` | `media_file_id: String` `#[pg(index)]`, `task_id: String` `#[pg(index)]`, `project_id: String` `#[pg(index)]` | Tautan file↔task (many-to-many). |

```rust
#[derive(Component)] struct MediaFileTag;
#[derive(Component)]
struct MediaFileInfo {
    #[pg(index)] project_id: String,
    file_name: String, original_file_name: String,
    #[pg(index)] mime_type: String,
    size: i64, storage_key: String,
    #[pg(index)] uploaded_by: String,
    #[pg(index)] created_at: String,
    status: MediaStatus,
}
#[derive(Component)] enum MediaStatus { Pending, Ready }

#[derive(Component)] struct TaskMediaLinkTag;
#[derive(Component)]
struct TaskMediaLinkData {
    #[pg(index)] media_file_id: String,
    #[pg(index)] task_id: String,
    #[pg(index)] project_id: String,
}
```

## 3. Alur Unggah (presigned, dua langkah)

1. **`CreateMediaUpload`** — client kirim `{project_id, file_name, mime_type, size}`. Backend:
   - buat `storage_key` unik (mis. `{project_id}/{uuid}/{file_name}`),
   - buat entity `MediaFileInfo` status **`Pending`**,
   - terbitkan **presigned PUT** ke S3 untuk `storage_key`,
   - balikan `{ media_file_id, upload_url, storage_key }`.
2. **Client PUT** byte langsung ke `upload_url` (S3/RustFS).
3. **`CompleteMediaUpload`** — client kirim `{media_file_id}`. Backend verifikasi objek ada (opsional cek `size`/`ETag`), set status **`Ready`**, balikan `MediaFile`.

- **Pending yang tak selesai** dianggap sampah → boleh di-GC oleh job terpisah (di luar cakupan; catat).
- **Unduh:** `GetMediaDownloadUrl(media_file_id)` → presigned **GET** ber-TTL pendek (mis. 5 menit). List **tidak** menyertakan URL agar murah.

## 4. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.media.v1;

service MediaService {
  rpc CreateMediaUpload(CreateMediaUploadRequest) returns (CreateMediaUploadResponse);
  rpc CompleteMediaUpload(CompleteMediaUploadRequest) returns (MediaFile);
  rpc ListProjectMedia(ListProjectMediaRequest) returns (ListMediaResponse);
  rpc GetMediaDownloadUrl(GetMediaDownloadUrlRequest) returns (GetMediaDownloadUrlResponse);
  rpc DeleteMediaFile(DeleteMediaFileRequest) returns (DeleteMediaFileResponse);

  // Tautan ke task
  rpc LinkTaskMedia(LinkTaskMediaRequest) returns (LinkTaskMediaResponse);
  rpc UnlinkTaskMedia(UnlinkTaskMediaRequest) returns (UnlinkTaskMediaResponse);
  rpc ListTaskMedia(ListTaskMediaRequest) returns (ListMediaResponse);
}

message MediaFile {
  string id = 1; string project_id = 2;
  string file_name = 3; string original_file_name = 4;
  string mime_type = 5; int64 size = 6;
  string uploaded_by = 7; string created_at = 8;
  MediaStatus status = 9;
}
enum MediaStatus { MEDIA_STATUS_UNSPECIFIED = 0; PENDING = 1; READY = 2; }

message CreateMediaUploadRequest { string project_id = 1; string file_name = 2; string mime_type = 3; int64 size = 4; }
message CreateMediaUploadResponse { string media_file_id = 1; string upload_url = 2; string storage_key = 3; }
message CompleteMediaUploadRequest { string media_file_id = 1; }

message ListProjectMediaRequest { string project_id = 1; }
message ListMediaResponse { repeated MediaFile files = 1; }

message GetMediaDownloadUrlRequest { string media_file_id = 1; }
message GetMediaDownloadUrlResponse { string url = 1; uint32 expires_in = 2; }

message DeleteMediaFileRequest { string media_file_id = 1; }
message DeleteMediaFileResponse { bool ok = 1; }

message LinkTaskMediaRequest { string task_id = 1; string media_file_id = 2; }
message LinkTaskMediaResponse { bool ok = 1; }
message UnlinkTaskMediaRequest { string task_id = 1; string media_file_id = 2; }
message UnlinkTaskMediaResponse { bool ok = 1; }
message ListTaskMediaRequest { string task_id = 1; }
```

## 5. Aturan & Guard

| Operasi | Siapa boleh | Aturan |
|---|---|---|
| `CreateMediaUpload` / `CompleteMediaUpload` | **member** | `project_id` harus projek tempat user member. `uploaded_by` = pemanggil. |
| `ListProjectMedia` / `GetMediaDownloadUrl` / `ListTaskMedia` | member atau admin | Hanya file status `Ready` yang tampil di list. |
| `DeleteMediaFile` | **uploader, owner, atau admin** | Hapus objek S3 + row + **semua** `TaskMediaLink`-nya. |
| `LinkTaskMedia` / `UnlinkTaskMedia` | **member** | `task_id` & `media_file_id` harus di projek yang sama. Idempoten. |

- **Validasi ukuran/tipe** (opsional): batas ukuran & allow-list MIME diterapkan di `CreateMediaUpload` (keputusan §8).
- **Presigned scope:** PUT dibatasi `storage_key` + `mime_type`; GET ber-TTL pendek.
- **Side-effect (emit):** `CompleteMediaUpload` & `DeleteMediaFile` meng-emit **Activity** (`Media` · Created/Deleted) — lihat [Activity](./2026-07-29-activity-feed-flow-design.md) §5.

## 6. Konfigurasi Storage (S3/RustFS)

Env backend Rust: `S3_ENDPOINT` (mis. `http://localhost:9000`), `S3_BUCKET` (`tasks-media`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE=true` (untuk RustFS/MinIO). Backend memakai SDK S3 (mis. `aws-sdk-s3` / `rust-s3`) untuk presign.

## 7. Frontend

Halaman `media.tsx` + komponen `file-manager-*` (disederhanakan). Migrasi CSS Module → **Tailwind** saat disentuh. **Buang** logika sub-project & `useResolveMediaProjectId`.

- **File manager:** grid/list file projek (ikon per MIME, nama, ukuran, uploader, tanggal). Datar (tanpa folder).
- **Upload dialog:** pilih file → `CreateMediaUpload` → PUT ke `upload_url` (progress) → `CompleteMediaUpload` → refresh. Multi-file didukung.
- **Unduh:** klik → `GetMediaDownloadUrl` → buka URL.
- **Hapus:** konfirmasi → `DeleteMediaFile` (terlihat untuk uploader/owner/admin).
- **Attach ke task:** dari **dialog task** (tab all-tasks) — pilih dari file projek atau unggah baru → `LinkTaskMedia`; daftar lampiran task via `ListTaskMedia`; lepas via `UnlinkTaskMedia`. *(Dok all-tasks menunda UI ini ke sini; kontraknya di §4.)*
- **Hooks (Connect):** `useProjectMedia`, `useCreateMediaUpload`, `useCompleteMediaUpload`, `useMediaDownloadUrl`, `useDeleteMediaFile`, `useTaskMedia`, `useLinkTaskMedia`, `useUnlinkTaskMedia`. Util unggah `putToPresignedUrl(file, url)`.

## 8. Di Luar Cakupan

- **Organisasi folder/per-module**, tag, pencarian file.
- **GC file `Pending`** yatim (job terpisah) — hanya dicatat.
- **Preview in-app** (image/pdf viewer) lanjutan; mulai dari unduh/buka-tab.
- **Versi file**, quota per-projek, virus scan.
- **Migrasi file** dari service media lama ke storage baru.

## 9. Keputusan Terbuka (usul)

1. **Guard `DeleteMediaFile`** — uploader/owner/admin vs semua member. — *Usul: uploader/owner/admin (cegah hapus file orang lain sembarangan).*
2. **Batas ukuran & allow-list MIME.** — *Usul: batas wajar (mis. 50–100MB) + allow-list umum; angka final saat implementasi.*
3. **Verifikasi `CompleteMediaUpload`** (HEAD objek / cek ETag) vs percaya client. — *Usul: HEAD objek untuk pastikan ada + ambil size sebenarnya.*
4. **Nama file duplikat** — biarkan (storage_key unik via uuid) vs dedup. — *Usul: biarkan; keunikan dijamin `storage_key`.*
5. **SDK S3 Rust** (`aws-sdk-s3` vs `rust-s3`). — *Perlu diputuskan saat implementasi; keduanya mendukung presign + path-style.*
