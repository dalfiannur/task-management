# Flow: Comments (Komentar Task) — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Komentar pada **task** — daftar, buat, edit, hapus, **@mention**. Komentar tampil di dialog task (tab all-tasks). Mention memicu **notifikasi** (model dimiliki flow Notifications).
- **Terkait:** [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [Users/Auth](./2026-07-29-users-auth-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Komentar = diskusi **datar** (tanpa threading) pada satu task.

- **Konten Markdown** ringan + **@mention** user.
- **Kolaboratif:** semua **member** boleh berkomentar; **edit** hanya penulis; **hapus** penulis/owner/admin (moderasi).
- **Mention → notifikasi:** @mention user memicu notifikasi (type `mention`) — side-effect ke flow Notifications.

## 2. Model Data — ECS Arke

| Komponen | Field | Semantik |
|---|---|---|
| `CommentTag` | — | Penanda entity komentar. |
| `CommentInfo` | `task_id: String` `#[pg(index)]`, `author_id: String` `#[pg(index)]`, `content: String` (Markdown), `mentioned_user_ids: Vec<String>` (JSONB), `created_at: String` `#[pg(index)]`, `updated_at: String` | Isi komentar + mention. |

```rust
#[derive(Component)] struct CommentTag;
#[derive(Component)]
struct CommentInfo {
    #[pg(index)] task_id: String,
    #[pg(index)] author_id: String,
    content: String, // Markdown
    mentioned_user_ids: Vec<String>, // JSONB
    #[pg(index)] created_at: String,
    updated_at: String,
}
```

- **Nama penulis tidak didenormalkan** (buang `authorName` legacy) — resolve via direktori user (`GetUser`), sumber kebenaran tunggal.
- **Mention** disimpan eksplisit sebagai daftar id (bukan hanya di-parse dari teks), agar notifikasi & highlight konsisten.

## 3. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.comment.v1;

service CommentService {
  rpc ListComments(ListCommentsRequest) returns (ListCommentsResponse);
  rpc CreateComment(CreateCommentRequest) returns (Comment);
  rpc UpdateComment(UpdateCommentRequest) returns (Comment);
  rpc DeleteComment(DeleteCommentRequest) returns (DeleteCommentResponse);
}

message Comment {
  string id = 1; string task_id = 2; string author_id = 3;
  string content = 4; repeated string mentioned_user_ids = 5;
  string created_at = 6; string updated_at = 7;
}

message ListCommentsRequest { string task_id = 1; uint32 page = 2; uint32 page_size = 3; }
message ListCommentsResponse { repeated Comment comments = 1; uint32 total = 2; }
message CreateCommentRequest { string task_id = 1; string content = 2; repeated string mentioned_user_ids = 3; }
message UpdateCommentRequest { string id = 1; string content = 2; repeated string mentioned_user_ids = 3; }
message DeleteCommentRequest { string id = 1; }
message DeleteCommentResponse { bool ok = 1; }
```

## 4. Aturan & Guard

| Operasi | Siapa boleh | Aturan |
|---|---|---|
| `ListComments` | member atau admin | Projek diturunkan dari task. Diurut `created_at` (asc/desc — UI), dipaginasi. |
| `CreateComment` | **semua member** | `content` non-kosong. `author_id` = pemanggil. Mention diproses (§5). |
| `UpdateComment` | **penulis saja** | Selain penulis → `PERMISSION_DENIED`. Set `updated_at`. Mention di-recompute; notifikasi hanya untuk mention **baru**. |
| `DeleteComment` | **penulis, owner, atau admin** | Moderasi oleh owner/admin. |

## 5. Mention → Notifikasi (side-effect)

- **Scope mention:** hanya **member projek** yang valid; id non-member **diabaikan** (toleran).
- **Create:** untuk tiap mention valid, emit notifikasi `mention` ke user tsb (kecuali mention diri sendiri).
- **Update:** hanya mention yang **baru ditambah** (selisih terhadap daftar lama) yang memicu notifikasi.
- **Kontrak notifikasi** (message, tipe, payload taskId) dimiliki **flow Notifications**; dok ini hanya **memanggil** emit. Bila flow Notifications belum ada, emit menjadi no-op yang aman.

## 6. Frontend

Komentar tampil di **dialog task** (tab all-tasks; UI di sini, bukan di dok all-tasks).

- **Daftar:** thread datar, tiap item: avatar+nama penulis (resolve `useUser`), waktu, konten Markdown (render aman), badge "edited" bila `updated_at != created_at`.
- **Composer:** editor Markdown ringan + **@mention autocomplete** dari **member projek**; submit → `CreateComment`.
- **Edit/Hapus:** aksi pada komentar sendiri (edit); hapus untuk penulis/owner/admin (konfirmasi).
- **Pagination/infinite scroll** untuk task ramai.
- **Hooks (Connect):** `useComments(taskId)`, `useCreateComment`, `useUpdateComment`, `useDeleteComment`. Tipe flat `Comment`.

## 7. Di Luar Cakupan

- **Threading/replies**, reaksi emoji.
- **Attachment** langsung di komentar (pakai media flow bila perlu).
- **Edit history/revisi** komentar.
- **Model & pengiriman notifikasi** (flow Notifications).

## 8. Keputusan Terbuka (usul)

1. **Mention non-member:** abaikan vs error. — *Usul: abaikan (toleran).*
2. **Sanitasi Markdown** (GFM, tanpa HTML mentah). — *Usul: sama seperti pages.*
3. **Urutan & paginasi** (terbaru di bawah, load-older). — *Usul: kronologis asc + load-older.*
4. **Emit notifikasi sebelum flow Notifications ada** — no-op aman vs tunda fitur mention. — *Usul: no-op aman; aktif saat Notifications siap.*
