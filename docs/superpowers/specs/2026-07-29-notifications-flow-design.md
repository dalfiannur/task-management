# Flow: Notifications — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Notifikasi in-app **+ real-time**: model, emit (mention/assignment/membership/approval), list/unread/mark-read, dan **stream real-time** via Connect server-streaming.
- **Terkait:** [Comments](./2026-07-29-comments-flow-design.md) · [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Users/Auth](./2026-07-29-users-auth-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Notifikasi memberi tahu user tentang hal yang menyangkut dirinya. **In-app** (bell + daftar + badge unread) **plus real-time push** (badge instan).

- **Emit internal.** Service lain memanggil helper `emit_notification`; **no-op bila `recipient == actor`** (tak menotifikasi diri sendiri).
- **Snapshot message.** Teks notifikasi dirender saat emit dan disimpan — feed tetap benar meski task/user berubah kemudian.
- **Real-time via Connect server-streaming.** Satu RPC stream mengirim notifikasi baru ke pemilik.

## 2. Event yang Memicu

| Event | Type | Recipient | Sumber |
|---|---|---|---|
| @mention di komentar | `Mention` | user yang di-mention | [Comments](./2026-07-29-comments-flow-design.md) |
| Ditugaskan ke task | `TaskAssigned` | assignee baru | All-Tasks (`UpdateTask`/`CreateTask`) |
| Ditambah ke projek | `ProjectMemberAdded` | user yang ditambah | Members (`AddProjectMember`) |
| Ownership ditransfer ke kamu | `OwnershipTransferred` | owner baru | Members/Detail (`TransferProjectOwnership`) |
| Akun di-approve | `AccountApproved` | user yang diaktifkan | Users/Auth (`ActivateUser`) |

## 3. Model Data — ECS Arke

| Komponen | Field | Semantik |
|---|---|---|
| `NotificationTag` | — | Penanda entity notifikasi. |
| `NotificationInfo` | `recipient_id: String` `#[pg(index)]`, `type: NotificationType` `#[pg(index)]`, `actor_id: String`, `message: String` (snapshot), `read: bool` `#[pg(index)]`, `created_at: String` `#[pg(index)]` | Inti notifikasi. |
| `NotificationRefs` | `project_id: Option<String>`, `task_id: Option<String>`, `comment_id: Option<String>` | Target deep-link (navigasi saat diklik). |

```rust
#[derive(Component)] struct NotificationTag;
#[derive(Component)]
struct NotificationInfo {
    #[pg(index)] recipient_id: String,
    #[pg(index)] type_: NotificationType,
    actor_id: String,
    message: String,   // dirender saat emit
    #[pg(index)] read: bool,
    #[pg(index)] created_at: String,
}
#[derive(Component)]
enum NotificationType { Mention, TaskAssigned, ProjectMemberAdded, OwnershipTransferred, AccountApproved }

#[derive(Component)]
struct NotificationRefs { project_id: Option<String>, task_id: Option<String>, comment_id: Option<String> }
```

- **Buang denormalisasi `actorName`/`taskTitle`** — nama sudah di `message`; avatar actor di-resolve via direktori (`actor_id`). `read` jadi **bool** (bukan string "true"/"false").

## 4. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.notification.v1;

service NotificationService {
  rpc ListNotifications(ListNotificationsRequest) returns (ListNotificationsResponse);
  rpc UnreadCount(UnreadCountRequest) returns (UnreadCountResponse);
  rpc MarkRead(MarkReadRequest) returns (OkResponse);
  rpc MarkAllRead(MarkAllReadRequest) returns (OkResponse);
  rpc StreamNotifications(StreamNotificationsRequest) returns (stream Notification); // real-time
}

message Notification {
  string id = 1; NotificationType type = 2; string actor_id = 3; string message = 4;
  bool read = 5; string created_at = 6;
  optional string project_id = 7; optional string task_id = 8; optional string comment_id = 9;
}
enum NotificationType {
  NOTIFICATION_TYPE_UNSPECIFIED = 0; MENTION = 1; TASK_ASSIGNED = 2;
  PROJECT_MEMBER_ADDED = 3; OWNERSHIP_TRANSFERRED = 4; ACCOUNT_APPROVED = 5;
}

message ListNotificationsRequest { uint32 page = 1; uint32 page_size = 2; }
message ListNotificationsResponse { repeated Notification notifications = 1; uint32 total = 2; }
message UnreadCountRequest {}
message UnreadCountResponse { uint32 count = 1; }
message MarkReadRequest { repeated string ids = 1; }
message MarkAllReadRequest {}
message StreamNotificationsRequest {}
message OkResponse { bool ok = 1; }
```

- Semua operasi **scoped ke `AuthUser.id`** (recipient = pemanggil). `MarkRead` hanya menandai notifikasi milik pemanggil.

## 5. Emit (side-effect internal)

- Helper bersama `emit_notification(recipient_id, type, actor_id, message, refs)`:
  1. **no-op** bila `recipient_id == actor_id`,
  2. persist `NotificationInfo` + `NotificationRefs` (`read=false`),
  3. **push** ke stream aktif milik `recipient_id` (§6).
- Dipanggil oleh service terkait (Comment/Task/Project/Auth) di dalam handler mutasinya, **setelah** mutasi utama sukses.

## 6. Real-time (server-streaming)

- **Transport:** `StreamNotifications` = **Connect server-streaming** (didukung `connect-web`; connectrpc-axum melayani streaming). Client membuka stream setelah login; server mengirim `Notification` baru saat emit.
- **Mekanisme (single-instance):** registry in-memory `recipient_id → sender channel(s)`; `emit_notification` mem-broadcast ke channel milik recipient. Reconnect otomatis dari client bila stream putus; badge unread tetap benar karena `UnreadCount`/`List` membaca dari Postgres (sumber kebenaran).
- **⚠️ Multi-instance (open):** dengan >1 instance backend, emit di instance A tak otomatis sampai ke stream user di instance B. Ini **keputusan terbuka yang sama** dengan koherensi cache fondasi ([§12 no.4](./2026-07-29-platform-foundation-design.md)) → solusi: **Postgres `LISTEN/NOTIFY`** atau message broker sebagai fan-out. **Untuk skeleton/awal:** single-instance in-memory; catat sebagai batas.
- **Degradasi anggun:** bila stream tak tersedia, frontend jatuh ke **polling** `UnreadCount`/`List` (mekanisme in-app tetap jalan).

## 7. Frontend

- **Bell + dropdown:** ikon di header dengan badge unread; daftar notifikasi (avatar actor via `useUser`, message, waktu, indikator unread). Klik → navigasi via refs (task/comment/project) + `MarkRead`.
- **Real-time:** buka `StreamNotifications` saat autentikasi; tiap pesan menambah item & menaikkan badge; fallback polling bila stream mati.
- **Aksi:** "Mark all read" → `MarkAllRead`.
- **Hooks (Connect):** `useNotifications`, `useUnreadCount`, `useMarkRead`, `useMarkAllRead`, `useNotificationStream` (mengelola koneksi stream + fallback poll).

## 8. Di Luar Cakupan

- **Email / push mobile**, notifikasi digest.
- **Preferensi/mute** per-tipe atau per-projek.
- **Retensi/cleanup** notifikasi lama (job terpisah) — hanya dicatat.
- **Fan-out multi-instance** (LISTEN/NOTIFY / broker) — ditunda (§6), selaras keputusan fondasi.

## 9. Keputusan Terbuka (usul)

1. **Transport real-time:** Connect server-streaming vs SSE/WebSocket terpisah. — *Usul: Connect server-streaming (satu stack, satu auth interceptor).*
2. **Fan-out multi-instance.** — *Usul: mulai single-instance; adopsi Postgres `LISTEN/NOTIFY` saat scale, bareng keputusan cache fondasi.*
3. **Retensi** (auto-hapus notifikasi >N hari / >N baris per user). — *Usul: tunda; job cleanup nanti.*
4. **Batch emit** untuk banyak recipient (mis. mention massal). — *Usul: loop sederhana dulu.*
