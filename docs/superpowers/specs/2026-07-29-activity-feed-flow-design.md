# Flow: Activity Feed — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** **Audit log projek menyeluruh** — merekam perubahan Task, Module, Membership/Ownership, Pages, Media; menyajikan riwayat per-entity (mis. per-task), feed per-projek, dan feed terbaru lintas-projek (dipakai Dashboard).
- **Terkait:** [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Pages](./2026-07-29-project-pages-tab-flow-design.md) · [Media](./2026-07-29-project-media-tab-flow-design.md) · [Comments](./2026-07-29-comments-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Activity = **jejak "siapa melakukan apa"** dalam projek, digeneralisasi ke banyak entity.

- **Emit internal**, dipanggil handler mutasi **setelah** aksi sukses. **Tidak** no-op-self (aksi sendiri tetap tercatat).
- **Snapshot `summary`** dirender saat emit → feed tetap terbaca meski entity kemudian dihapus.
- **Diff terstruktur** untuk update (field, dari, ke).
- **Read = member** (projek), scoped ke keanggotaan.

## 2. Model Data — ECS Arke

| Komponen | Field | Semantik |
|---|---|---|
| `ActivityTag` | — | Penanda entity activity. |
| `ActivityInfo` | `project_id: String` `#[pg(index)]`, `actor_id: String` `#[pg(index)]`, `entity_type: EntityType` `#[pg(index)]`, `entity_id: String` `#[pg(index)]`, `action: ActivityAction` `#[pg(index)]`, `summary: String` (snapshot), `created_at: String` `#[pg(index)]` | Inti activity. |
| `ActivityChanges` | `changes: Vec<FieldChange>` (JSONB) | Diff field (kosong untuk create/delete). |

```rust
#[derive(Component)] struct ActivityTag;
#[derive(Component)]
struct ActivityInfo {
    #[pg(index)] project_id: String,
    #[pg(index)] actor_id: String,
    #[pg(index)] entity_type: EntityType,
    #[pg(index)] entity_id: String,
    #[pg(index)] action: ActivityAction,
    summary: String,            // dirender saat emit
    #[pg(index)] created_at: String,
}
#[derive(Component)] enum EntityType { Task, Module, Membership, Ownership, Page, Media }
#[derive(Component)] enum ActivityAction { Created, Updated, Deleted }

// Bagian dari ActivityChanges (JSONB)
struct FieldChange { field: String, from: Option<String>, to: Option<String> }
```

- **Buang denormalisasi `actorName`/`taskTitle`** — nama di `summary`; actor di-resolve via direktori (`actor_id`).
- **`entity_type` + `entity_id`** menggantikan `taskId`/`coreProjectId` khusus-task → satu skema untuk semua entity.
- **Nuansa aksi** (mis. member ditambah vs dihapus, ownership transfer) dikodekan lewat `entity_type` + `action` + `summary` (mis. `Membership`+`Created` = "menambahkan X"; `Ownership`+`Updated` = "mentransfer ownership ke Y").

## 3. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.activity.v1;

service ActivityService {
  rpc ListProjectActivity(ListProjectActivityRequest) returns (ListActivityResponse); // feed 1 projek
  rpc ListEntityActivity(ListEntityActivityRequest) returns (ListActivityResponse);   // riwayat 1 entity (mis. task)
  rpc ListRecentActivity(ListRecentActivityRequest) returns (ListActivityResponse);   // lintas-projek (Dashboard)
}

message FieldChange { string field = 1; optional string from = 2; optional string to = 3; }
message Activity {
  string id = 1; string project_id = 2; string actor_id = 3;
  EntityType entity_type = 4; string entity_id = 5; ActivityAction action = 6;
  string summary = 7; repeated FieldChange changes = 8; string created_at = 9;
}
enum EntityType { ENTITY_TYPE_UNSPECIFIED = 0; TASK = 1; MODULE = 2; MEMBERSHIP = 3; OWNERSHIP = 4; PAGE = 5; MEDIA = 6; }
enum ActivityAction { ACTIVITY_ACTION_UNSPECIFIED = 0; CREATED = 1; UPDATED = 2; DELETED = 3; }

message ListProjectActivityRequest { string project_id = 1; uint32 page = 2; uint32 page_size = 3; }
message ListEntityActivityRequest { EntityType entity_type = 1; string entity_id = 2; }
message ListRecentActivityRequest { uint32 page = 1; uint32 page_size = 2; } // recipient's projects
message ListActivityResponse { repeated Activity activities = 1; uint32 total = 2; }
```

## 4. Aturan & Guard

| Operasi | Siapa | Aturan |
|---|---|---|
| `ListProjectActivity` | member atau admin | `project_id` harus projek tempat user member. Urut `created_at` desc, dipaginasi. |
| `ListEntityActivity` | member atau admin | Projek diturunkan dari entity; cek membership. |
| `ListRecentActivity` | user terautentikasi | **Scoped** ke projek tempat user jadi member (admin: semua). Untuk Dashboard. |
| *(record)* | **internal** | Dipanggil handler mutasi; bukan RPC publik. |

## 5. Emit (side-effect internal)

Helper `record_activity(project_id, actor_id, entity_type, entity_id, action, summary, changes)` dipanggil oleh handler mutasi **setelah sukses**:

| Sumber | entity_type · action | Contoh summary |
|---|---|---|
| CreateTask/UpdateTask/DeleteTask | `Task` · Created/Updated/Deleted | "membuat task 'Design'", "mengubah status Todo→Done" |
| CreateModule/UpdateModule/DeleteModule/Reorder | `Module` · Created/Updated/Deleted | "menambah module 'Sprint 1'" |
| AddProjectMember/RemoveProjectMember | `Membership` · Created/Deleted | "menambahkan Budi", "mengeluarkan Siti" |
| TransferProjectOwnership | `Ownership` · Updated | "mentransfer ownership ke Budi" |
| Create/Update/DeletePage | `Page` · Created/Updated/Deleted | "menyunting halaman 'Spec'" |
| Media upload(complete)/delete | `Media` · Created/Deleted | "mengunggah design.pdf" |

- **Diff (`changes`)** diisi hanya untuk `Updated` (field yang berubah).
- **Volume:** pages/media/comment-ramai bisa membuat feed padat — diterima; filter/paginasi menjaga UX. **Catatan performa:** setiap mutasi menulis 1 baris activity (dan mungkin push notifikasi) — sisipkan dalam transaksi yang sama bila memungkinkan.

## 6. Frontend

Activity **bukan tab tersendiri**; ia muncul di beberapa tempat:

- **Riwayat per-task:** di dialog task (bersama Comments) via `ListEntityActivity(TASK, taskId)` — mis. `task-activity-timeline`.
- **Feed projek:** section opsional di shell detail atau panel — `ListProjectActivity`.
- **Feed terbaru (Dashboard):** `ListRecentActivity` lintas-projek — dikonsumsi [Dashboard](./2026-07-29-dashboard-my-tasks-flow-design.md).
- **Render item:** avatar actor (`useUser`), `summary`, waktu; untuk `Updated`, tampilkan diff ringkas (field: dari→ke). Klik → deep-link ke entity bila masih ada.
- **Hooks (Connect):** `useProjectActivity`, `useEntityActivity`, `useRecentActivity`.

## 7. Di Luar Cakupan

- **Retensi/cleanup** activity lama (job terpisah) — dicatat.
- **Filter feed** lanjutan (per tipe/aktor/rentang) — dasar saja dulu.
- **Undo dari activity**, revert perubahan.
- **Comment** sebagai activity (comment punya feed sendiri; opsional dimasukkan nanti).

## 8. Keputusan Terbuka (usul)

1. **Field mana yang di-diff** untuk `Task.Updated` (semua vs subset penting: status/assignee/dates/priority). — *Usul: subset penting agar ringkas.*
2. **Sertakan Comment** sebagai activity? — *Usul: tidak (hindari duplikasi dengan thread komentar).*
3. **Retensi** (auto-hapus >N hari / cap per projek). — *Usul: tunda; job cleanup nanti.*
4. **Transaksi emit** (activity+notifikasi dalam transaksi mutasi) vs best-effort async. — *Usul: dalam transaksi bila `arke-postgres` mendukung; jika tidak, best-effort setelah commit.*
