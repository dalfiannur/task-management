# Flow: Dashboard & My-Tasks — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Agregasi **lintas-projek** untuk user: **Dashboard** (statistik, progress per-projek, deadline mendatang, recent activity) + **My-Tasks** (Ditugaskan / Dibuat / Melibatkan saya).
- **Terkait:** [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [Activity](./2026-07-29-activity-feed-flow-design.md) · [Comments](./2026-07-29-comments-flow-design.md) · [List & Detail](./2026-07-29-project-list-detail-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Halaman lintas-projek, semua **scoped ke keanggotaan** user (projek tempat ia member; admin: semua).

- **Tanpa model data baru.** Semua adalah **agregasi/read** atas Task/Project/Comment/Activity yang sudah ada.
- **Delivery murni:** statistik berbasis task saja — **tanpa `winStage`/sales** (dibuang dari dashboard legacy).
- **Recent activity** memakai `ListRecentActivity` dari [flow Activity](./2026-07-29-activity-feed-flow-design.md).

## 2. Dashboard

### 2.1 Widget
1. **Statistik task** — `total`, `in_progress`, `done`, `overdue` (due lewat & belum `done`/`cancelled`) lintas projek member.
2. **Progress per-projek** — untuk tiap projek member: `done` / `total` (bar progres).
3. **Deadline mendatang saya** — task **assigned ke saya**, `due_date` dalam N hari, belum `done`/`cancelled`.
4. **Recent activity** — feed lintas-projek via `ActivityService.ListRecentActivity`.

### 2.2 Kontrak (Connect)
```proto
package sedjiwa.tasks.dashboard.v1;

service DashboardService {
  rpc GetDashboardStats(GetDashboardStatsRequest) returns (DashboardStats);
  rpc GetUpcomingDeadlines(GetUpcomingDeadlinesRequest) returns (TaskListResponse);
}

message GetDashboardStatsRequest {}          // scope diturunkan dari AuthUser
message DashboardStats {
  uint32 total_tasks = 1;
  uint32 in_progress_tasks = 2;
  uint32 done_tasks = 3;
  uint32 overdue_tasks = 4;
  repeated ProjectProgress per_project = 5;
}
message ProjectProgress { string project_id = 1; string project_name = 2; uint32 done = 3; uint32 total = 4; }

message GetUpcomingDeadlinesRequest { uint32 within_days = 1; } // default 7
message TaskListResponse { repeated MyTask items = 1; }
```

## 3. My-Tasks

Tiga tampilan (tab), semua lintas-projek member, dengan filter status/priority + paginasi.

| View | Definisi |
|---|---|
| **Ditugaskan ke saya** | task dengan `AuthUser.id ∈ assignee_ids`. |
| **Dibuat oleh saya** | task dengan `created_by == AuthUser.id`. |
| **Melibatkan saya** | task yang saya **komentari** (author) **atau** saya **di-mention** di komentarnya. |

### 3.1 Kontrak (Connect)
```proto
package sedjiwa.tasks.mytasks.v1;

service MyTasksService {
  rpc ListAssignedToMe(MyTasksRequest) returns (MyTasksResponse);
  rpc ListCreatedByMe(MyTasksRequest) returns (MyTasksResponse);
  rpc ListInvolvingMe(MyTasksRequest) returns (MyTasksResponse);
}

message MyTasksRequest {
  optional TaskStatus status = 1;     // dari all-tasks
  optional TaskPriority priority = 2;
  uint32 page = 3; uint32 page_size = 4;
}
message MyTask {           // task + konteks projek/module untuk tampilan lintas-projek
  Task task = 1;           // pesan Task dari flow all-tasks
  string project_id = 2; string project_name = 3; string module_name = 4;
}
message MyTasksResponse { repeated MyTask items = 1; uint32 total = 2; }
```

> `MyTask` **memperkaya** `Task` dengan `project_id/project_name/module_name` karena daftar lintas-projek butuh konteks itu (task hanya menyimpan `module_id`).

## 4. Aturan & Guard

| Operasi | Siapa | Aturan |
|---|---|---|
| `GetDashboardStats` / `GetUpcomingDeadlines` | user terautentikasi | Dihitung **hanya** atas projek tempat user member (admin: semua). |
| `ListAssignedToMe` / `ListCreatedByMe` / `ListInvolvingMe` | user terautentikasi | Scoped ke projek member; filter & paginasi diterapkan server. |

- **"Melibatkan saya":** server mengumpulkan `task_id` dari komentar (author `= me` **atau** `me ∈ mentioned_user_ids`) di projek member, lalu memuat task-nya (distinct).
- **Overdue:** `due_date < today` **dan** status ∉ {`done`,`cancelled`}.

## 5. Catatan Performa

- Semua endpoint = agregasi yang **memindai task/komentar di banyak projek**. Ini kasus yang paling diuntungkan **cache hasil-query** (keputusan terbuka [fondasi §12 no.5](./2026-07-29-platform-foundation-design.md)).
- **Usul awal:** hitung langsung dari Postgres (indeks `assignee`/`created_by`/`status`/`due_date`/`comment` membantu); optimasi/cache menyusul bila perlu.
- `MyTask` enrichment (project/module name) di-resolve via join/lookup ringan; hindari N+1 dengan batch.

## 6. Frontend

- **`dashboard.tsx`** — grid StatCard (total/in-progress/done/overdue) + progress per-projek + panel deadline mendatang + panel recent activity. **Buang** filter `winStage`/sales.
- **`my-tasks.tsx`** — tiga tab (Ditugaskan/Dibuat/Melibatkan) dengan filter status/priority; tiap baris menampilkan konteks projek+module; klik → buka dialog task di projeknya.
- **Hooks (Connect):** `useDashboardStats`, `useUpcomingDeadlines`, `useAssignedToMe`, `useCreatedByMe`, `useInvolvingMe`, `useRecentActivity` (dari Activity).
- **Rute:** `/dashboard`, `/my-tasks` (dan hapus `/tasks-by-me` terpisah → jadi tab di my-tasks), sesuai router.

## 7. Di Luar Cakupan

- **Chart/tren** lanjutan (burndown, velocity).
- **Kustomisasi widget** / drag-arrange dashboard.
- **Ekspor** laporan.
- **Filter lanjutan** (per-projek, per-label) di my-tasks — dasar dulu.

## 8. Keputusan Terbuka (usul)

1. **`within_days` default** untuk deadline. — *Usul: 7 hari.*
2. **Gabung `tasks-by-me` ke my-tasks** sebagai tab. — *Usul: ya (satu halaman, tiga tab).*
3. **Sertakan task `cancelled`** di statistik total. — *Usul: `total` menghitung semua non-`cancelled`; tampilkan `done`/`in_progress` terpisah.*
4. **Cache agregasi.** — *Usul: tanpa cache dulu (§5), selaras keputusan fondasi.*
5. **"Melibatkan saya" termasuk task yang saya buat/di-assign?** — *Usul: tidak (hindari tumpang tindih; murni keterlibatan via komentar/mention).*
