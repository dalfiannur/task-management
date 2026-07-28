# Flow: Tab All-Tasks (Modules & Tasks) — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Isi **tab all-tasks** — **Modules** (CRUD/reorder) + **Tasks** (CRUD/reorder/pindah + field inti) + tampilan module-grouped + dialog create/edit task. **Di luar:** manajemen palette Labels, Comments, Media-attach, Activity, board/kanban, filter/sort lanjutan.
- **Terkait:** [Create Projek](./2026-07-29-create-project-flow-design.md) · [List & Detail-Shell](./2026-07-29-project-list-detail-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Hierarki kerja: **Project → Modules → Tasks**. Tab all-tasks adalah tampilan utama: daftar **module** (terurut), masing-masing berisi **task** (terurut), dengan drag-and-drop.

Keputusan yang membentuk desain ini:

- **Module = pengelompok ringan.** Field: nama, deskripsi, order. **Tanpa PIC** (penanggung jawab cukup di level task via assignees).
- **Guard terbedakan:** **struktur (module) dikelola owner/admin**; **task dikelola semua member** (kolaboratif).
- **Assignee hanya member projek.**
- **Status task** tetap `todo / in_progress / done / cancelled`; **priority** `none / low / medium / high / urgent`.

## 2. Model Data — ECS Arke

### 2.1 Module

| Komponen | Field | Semantik |
|---|---|---|
| `ModuleTag` | — | Penanda entity module. |
| `ModuleName` | `value: String` | Nama module (wajib). |
| `ModuleDescription` | `value: String` | Deskripsi (opsional). |
| `ModuleProjectRef` | `project_id: String` `#[pg(index)]` | Projek pemilik. |
| `ModuleOrder` | `value: i32` `#[pg(index)]` | Urutan dalam projek. |

*(Dihapus dari legacy: `ModulePicId`.)*

### 2.2 Task

| Komponen | Field | Semantik |
|---|---|---|
| `TaskTag` | — | Penanda entity task. |
| `TaskInfo` | `title: String`, `description: String`, `status: TaskStatus` `#[pg(index)]`, `priority: TaskPriority` `#[pg(index)]`, `start_date: Option<String>`, `due_date: Option<String>`, `order: i32` `#[pg(index)]` | Inti task. |
| `TaskModuleRef` | `module_id: String` `#[pg(index)]` | Module pemilik (menentukan projek via module). |
| `TaskAssignees` | `user_ids: Vec<String>` (JSONB) | Assignee — **harus member projek** (§4). |
| `TaskLabels` | `label_ids: Vec<String>` (JSONB) | Referensi ke Label (palette = flow lain). |
| `TaskAudit` | `created_at: String`, `updated_at: String`, `completed_at: Option<String>`, `created_by: String` | Jejak. |

```rust
#[derive(Component)] struct TaskTag;

#[derive(Component)]
struct TaskInfo {
    title: String,
    description: String,
    #[pg(index)] status: TaskStatus,
    #[pg(index)] priority: TaskPriority,
    start_date: Option<String>,
    due_date: Option<String>,
    #[pg(index)] order: i32,
}
#[derive(Component)] enum TaskStatus { Todo, InProgress, Done, Cancelled }
#[derive(Component)] enum TaskPriority { None, Low, Medium, High, Urgent }

#[derive(Component)] struct TaskModuleRef { #[pg(index)] module_id: String }
#[derive(Component)] struct TaskAssignees { user_ids: Vec<String> } // JSONB
#[derive(Component)] struct TaskLabels { label_ids: Vec<String> }   // JSONB
#[derive(Component)]
struct TaskAudit { created_at: String, updated_at: String, completed_at: Option<String>, created_by: String }
```

> Assignees/labels sebagai `Vec<String>` (JSONB) menggantikan trik "JSON-encoded string" di legacy (`TaskAssignment.assigneeIds` / `TaskLabels.labelIds`).

## 3. Kontrak Backend (domain + Connect)

Dua service (mengikuti pemisahan yang ada). Semua ber-guard auth; **projek diturunkan dari module** untuk pengecekan membership/owner.

```proto
package sedjiwa.tasks.work.v1;

service ModuleService {
  rpc ListModules(ListModulesRequest) returns (ListModulesResponse);
  rpc CreateModule(CreateModuleRequest) returns (Module);
  rpc UpdateModule(UpdateModuleRequest) returns (Module);
  rpc DeleteModule(DeleteModuleRequest) returns (DeleteModuleResponse);
  rpc ReorderModules(ReorderModulesRequest) returns (ListModulesResponse);
}

service TaskService {
  rpc ListTasks(ListTasksRequest) returns (ListTasksResponse); // by project (semua module) atau by module
  rpc CreateTask(CreateTaskRequest) returns (Task);
  rpc UpdateTask(UpdateTaskRequest) returns (Task);
  rpc DeleteTask(DeleteTaskRequest) returns (DeleteTaskResponse);
  rpc MoveTask(MoveTaskRequest) returns (Task); // reorder dalam module & pindah antar-module
}

message Module { string id = 1; string name = 2; optional string description = 3; int32 order = 4; }

message ListModulesRequest { string project_id = 1; }
message ListModulesResponse { repeated Module modules = 1; }
message CreateModuleRequest { string project_id = 1; string name = 2; optional string description = 3; }
message UpdateModuleRequest { string id = 1; optional string name = 2; optional string description = 3; }
message DeleteModuleRequest { string id = 1; }
message DeleteModuleResponse { bool ok = 1; }
message ReorderModulesRequest { string project_id = 1; repeated string module_ids = 2; } // urutan baru

message Task {
  string id = 1; string module_id = 2;
  string title = 3; string description = 4;
  TaskStatus status = 5; TaskPriority priority = 6;
  optional string start_date = 7; optional string due_date = 8;
  int32 order = 9;
  repeated string assignee_ids = 10;
  repeated string label_ids = 11;
  string created_at = 12; string updated_at = 13; optional string completed_at = 14; string created_by = 15;
}
enum TaskStatus { TASK_STATUS_UNSPECIFIED = 0; TODO = 1; IN_PROGRESS = 2; DONE = 3; CANCELLED = 4; }
enum TaskPriority { TASK_PRIORITY_UNSPECIFIED = 0; NONE = 1; LOW = 2; MEDIUM = 3; HIGH = 4; URGENT = 5; }

message ListTasksRequest { string project_id = 1; optional string module_id = 2; }
message ListTasksResponse { repeated Task tasks = 1; }

message CreateTaskRequest {
  string module_id = 1; string title = 2; optional string description = 3;
  TaskStatus status = 4; TaskPriority priority = 5;
  optional string start_date = 6; optional string due_date = 7;
  repeated string assignee_ids = 8; repeated string label_ids = 9;
}
message UpdateTaskRequest {
  string id = 1;
  optional string title = 2; optional string description = 3;
  optional TaskStatus status = 4; optional TaskPriority priority = 5;
  optional string start_date = 6; optional string due_date = 7;
  repeated string assignee_ids = 8; // absen = tak diubah; kirim [] untuk kosongkan
  repeated string label_ids = 9;
}
message DeleteTaskRequest { string id = 1; }
message DeleteTaskResponse { bool ok = 1; }
message MoveTaskRequest { string id = 1; string module_id = 2; int32 order = 3; }
```

## 4. Aturan & Guard

| Operasi | Siapa boleh | Aturan |
|---|---|---|
| `ListModules` / `ListTasks` | member atau admin | Non-member → `PERMISSION_DENIED`. |
| `CreateModule` / `UpdateModule` / `DeleteModule` / `ReorderModules` | **owner atau admin** | Struktur projek. `DeleteModule` **cascade** menghapus semua task di module (konfirmasi di UI). |
| `CreateTask` / `UpdateTask` / `DeleteTask` / `MoveTask` | **semua member** (atau admin) | Kolaboratif. |

Aturan lintas-operasi:

1. **Assignee = member.** `assignee_ids` yang bukan member projek → `INVALID_ARGUMENT`. (Frontend membatasi picker ke member; backend tetap validasi.)
2. **`completed_at` otomatis.** Saat `status` berubah **ke `Done`**, set `completed_at = now`; saat keluar dari `Done`, `completed_at = null`.
3. **`updated_at` otomatis** di setiap `UpdateTask`/`MoveTask`. `created_by` = pemanggil saat create.
4. **Ordering.** `order` unik-relatif dalam satu module. `MoveTask` menetapkan `module_id` + `order` baru; server merapikan urutan module tujuan (dan asal). `ReorderModules` menata ulang `ModuleOrder` sesuai `module_ids`.
5. **Validasi module.** `CreateTask.module_id` & `MoveTask.module_id` harus module milik projek yang sama tempat user jadi member.
6. **Label refs.** `label_ids` divalidasi ada (opsional) tapi manajemen palette label = flow lain.
7. **Side-effects (emit).** Setelah mutasi sukses, handler **meng-emit**:
   - **Activity** (`record_activity`) untuk tiap create/update/delete Task & Module — lihat [Activity](./2026-07-29-activity-feed-flow-design.md) §5.
   - **Notifikasi `TaskAssigned`** ke assignee **baru** saat `CreateTask`/`UpdateTask` menambah assignee — lihat [Notifications](./2026-07-29-notifications-flow-design.md) §2.

## 5. Frontend — Tab All-Tasks

Halaman: konten tab `all-tasks` di shell detail (menggantikan `project-detail.tsx` yang sekarang). Migrasi ke **Tailwind** saat disentuh.

- **Susunan:** daftar **ModuleSection** terurut. Tiap section: header module (nama, jumlah task, aksi edit/hapus untuk owner/admin) + daftar **TaskRow**.
- **TaskRow:** checkbox/badge status, judul, priority icon, avatar assignees, chip labels, due date. Klik → **dialog detail/edit task**.
- **Create task inline:** input cepat di bawah tiap module → `CreateTask` (status default `Todo`, priority `None`).
- **Create/Update task dialog:** field inti — title, description, status, priority, start/due date (`DatePickerField`), assignees (`UserCombobox` **dibatasi member**), labels (`LabelCombobox`, dari palette yang ada). Comments/media di dalam dialog = **ditunda** (flow lain).
- **Module management (owner/admin):** tombol "Add module", edit/hapus module (hapus = konfirmasi cascade), **drag reorder module** (`ReorderModules`). Disembunyikan untuk member biasa.
- **Task DnD (semua member):** drag task untuk reorder dalam module & pindah antar-module → `MoveTask` (dnd-kit, seperti sekarang).
- **Empty states:** projek tanpa module → ajakan "Add module" (owner/admin) atau pesan kosong (member). Module tanpa task → input create.
- **Hooks (Connect):** `useModules`, `useCreateModule`, `useUpdateModule`, `useDeleteModule`, `useReorderModules`; `useTasks`, `useCreateTask`, `useUpdateTask`, `useDeleteTask`, `useMoveTask`. Mengembalikan tipe flat `Module`/`Task`.

## 6. Konfigurasi Status & Priority

Tetap seperti sekarang (dipertahankan): status `todo/in_progress/done/cancelled`, priority `none/low/medium/high/urgent` dengan label/warna/icon di `TASK_STATUS_CONFIG`/`TASK_PRIORITY_CONFIG`.

## 7. Di Luar Cakupan

- **Labels:** manajemen palette (buat/edit/hapus label) — flow tersendiri; di sini hanya me-*refer* label yang ada.
- **Comments**, **Media-attach** ke task, **Activity feed** — flow tersendiri.
- **Board/Kanban view**, **filter/sort lanjutan**, **My Tasks** (varian `listMyTasks`/`listTasksByMe`).
- **Recurring/subtask/dependency** — tidak ada.

## 8. Keputusan Terbuka (usul)

1. **`DeleteModule` cascade vs blokir bila ada task.** — *Usul: cascade + konfirmasi UI (tampilkan jumlah task terdampak).*
2. **`ListTasks` by-project sekaligus vs per-module.** — *Usul: by-project (satu fetch), dikelompokkan client-side by `module_id`; `module_id` opsional untuk kasus sempit.*
3. **Validasi `label_ids` ketat vs longgar.** — *Usul: longgar dulu (tak error bila label hilang), diperketat saat flow labels.*
4. **Batas panjang title / jumlah assignee.** — *Usul: title wajib non-kosong; batas lain YAGNI.*
