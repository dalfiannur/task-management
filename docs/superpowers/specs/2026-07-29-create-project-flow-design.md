# Flow Pertama: Membuat Projek Baru — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Definisi **model data Project lokal** + **flow membuat projek baru**. Migrasi read-path, migrasi data projek Core lama, dan fondasi platform (skeleton Rust/Connect) = **dokumen terpisah**.
- **Terkait:** [Fondasi Platform](./2026-07-29-platform-foundation-design.md) · [Flow List & Detail Projek](./2026-07-29-project-list-detail-flow-design.md)

---

## 1. Konteks & Prinsip

Projek berpindah **penuh ke lokal** (backend task-management) dan menjadi entity **delivery/task murni**. Seluruh konsep sales dari Core Portal — `winStage`, `commercial`, `value`, referensi `clientId`/`companyId`/`divisionId`/`eventId` — **dibuang**. Projek baru **langsung aktif** tanpa approval.

Dua keputusan model yang menyederhanakan struktur:

- **Tidak ada sub-project.** Hierarki cukup **Project → Modules → Tasks**. Komponen `ProjectParentRef`/`ProjectModuleRef` dan flow `createSubProject` **dihapus**. (Bisa ditambah lagi sengaja bila kebutuhan program/portfolio muncul.)
- **Konsep "leader" diganti "ownership".** Setiap projek punya **satu owner** (default = pembuat) dengan **otoritas**: kelola member, ubah status, hapus, dan transfer ownership. Owner otomatis jadi member.

Prinsip penulisan dok:

1. **Agnostik implementasi di lapis kontrak.** Kontrak operasi & model domain ditulis agar tetap berlaku lintas bahasa/transport. Detail Rust/Arke/Connect ada, tapi diberi label jelas sebagai *binding* yang bisa diganti.
2. **Sumber kebenaran = backend lokal.** Tidak ada lagi penulisan ke Core Portal saat create.
3. **Ramping (YAGNI).** Form create hanya mengumpulkan yang benar-benar perlu; sisanya diisi di flow lain.

## 2. Platform Target (fondasi)

Dok ini mengasumsikan platform target berikut. Migrasinya sendiri **di luar cakupan** (dicatat di §8):

| Lapis | Saat ini (legacy) | Target |
|---|---|---|
| Backend runtime | Bun + `bunsane` (ECS TS) | **Rust** |
| ECS | `bunsane` (archetype + decorator) | **Arke** (`arke` crate, archetype-based; persist via `arke-postgres`) |
| Transport | GraphQL (Apollo) | **gRPC / Connect** (`connectrpc`) |
| Client browser | Apollo Client | **`@connectrpc/connect-web`** (client TS ter-generate dari `.proto`) |
| DB | PostgreSQL | PostgreSQL (via `arke-postgres`, sumber kebenaran kolom-tipe) |

> Catatan sintaks Arke: `arke` adalah crate internal yang masih berkembang. Contoh kode di bawah memakai bentuk idiomatik (`#[derive(Component)]`, `spawn_bundle`, `#[pg(...)]`). Bentuk final **mengikuti API Arke versi terpakai** — sesuaikan saat implementasi.

## 3. Model Data — ECS Arke

Sebuah **projek adalah satu `Entity`** yang membawa sekumpulan komponen. Berbeda dari `bunsane`, di Arke **tidak ada deklarasi "archetype class"** — archetype muncul dari kombinasi komponen yang menempel. Komponen adalah struct biasa yang mengimplementasikan trait marker `Component`.

### 3.1 Komponen

| Komponen | Field | Semantik | Status |
|---|---|---|---|
| `ProjectTag` | — (marker) | Menandai entity sebagai Project. | **baru** |
| `ProjectName` | `value: String` | Nama projek (wajib). | **baru** |
| `ProjectDescription` | `value: String` | Deskripsi (opsional — komponen absen jika kosong). | **baru** |
| `ProjectOwnerId` | `value: String` `#[pg(index)]` | User ID **owner** (default = pembuat). Owner punya otoritas atas projek (§5). | **baru** (ganti leader) |
| `ProjectStatus` | `value: {Active, Completed, Archived}` | Status kerja (lihat §7). | **baru** |
| `ProjectDates` | `start_date: Option<Date>`, `end_date: Option<Date>` | Tanggal untuk timeline. **Diisi belakangan**, bukan saat create. | **baru** |
| `ProjectCoreRef` | `value: String` `#[pg(index)]` | **Legacy.** Tidak diisi untuk projek baru; dipertahankan sementara untuk transisi data lama. | legacy |

### 3.2 Definisi komponen (bentuk idiomatik Arke)

```rust
#[derive(Component)]
struct ProjectTag;

#[derive(Component)]
struct ProjectName { value: String }

#[derive(Component)]
struct ProjectDescription { value: String }

#[derive(Component)]
struct ProjectOwnerId {
    #[pg(index)]
    value: String,
}

#[derive(Component)]
enum ProjectStatus { Active, Completed, Archived }

#[derive(Component)]
struct ProjectDates {
    start_date: Option<String>, // ISO-8601 "yyyy-MM-dd"
    end_date: Option<String>,
}

// Legacy — tidak di-insert untuk projek baru.
#[derive(Component)]
struct ProjectCoreRef {
    #[pg(index)]
    value: String,
}
```

### 3.3 Membership

Membership tetap entity/komponen tersendiri (mengikuti pola `ProjectMembership` yang sudah ada). Detail modelnya milik flow membership, tapi flow create **wajib** membuat baris membership untuk **owner** (= pembuat pada create). Lihat §5.

### 3.4 Persistensi (arke-postgres)

- Tiap komponen → kolom bertipe di Postgres; **Postgres = sumber kebenaran**.
- Field ber-`#[pg(index)]` (`value` pada `ProjectOwnerId` & `ProjectCoreRef`) terindeks untuk lookup (mis. "projek milik owner X").
- Handler create memakai `save` / `save_incremental` untuk mem-persist entity baru dalam satu transaksi logis bersama membership.

## 4. Kontrak Operasi

Dinyatakan dua lapis: **domain (agnostik)** yang wajib, dan **binding gRPC/Connect** yang bisa diganti.

### 4.1 Lapis domain (agnostik transport)

**Operasi:** `CreateProject`

- **Input:** `name: String` (wajib, di-trim, non-kosong), `description?: String`, `ownerId?: String`
- **Output:** `Project` (representasi flat — lihat §4.2)
- **Auth:** memerlukan permission `Projects.Create`. Pemanggil harus terautentikasi (JWT). **Siapa yang memilikinya:** karena ini tool delivery self-serve, `Projects.Create` diberikan ke **semua user terautentikasi** (bukan admin-only); admin membawa `*` sehingga tetap tercakup. Definisi permission final milik dok auth/permissions — dok ini hanya mematok bahwa create tidak dibatasi admin.
- **Efek:** membuat 1 entity Project lokal + baris membership owner (§5). Tidak menyentuh Core Portal.
- **Error:**
  - `name` kosong/whitespace → `INVALID_ARGUMENT`
  - tak terautentikasi → `UNAUTHENTICATED`
  - tak punya permission → `PERMISSION_DENIED`
  - kegagalan persist → `INTERNAL`

### 4.2 Binding gRPC / Connect (sketsa `.proto`)

```proto
syntax = "proto3";
package sedjiwa.tasks.project.v1;

service ProjectService {
  rpc CreateProject(CreateProjectRequest) returns (Project);
  // Operasi lain (List/Get/Update) didefinisikan di flow masing-masing.
}

message CreateProjectRequest {
  string name = 1;
  optional string description = 2;
  optional string owner_id = 3; // kosong → owner = pemanggil
}

message Project {
  string id = 1;
  string name = 2;
  optional string description = 3;
  ProjectStatus status = 4;
  string owner_id = 5;
  optional string start_date = 6; // ISO-8601, diisi di flow lain
  optional string end_date = 7;
}

enum ProjectStatus {
  PROJECT_STATUS_UNSPECIFIED = 0;
  PROJECT_STATUS_ACTIVE = 1;
  PROJECT_STATUS_COMPLETED = 2;
  PROJECT_STATUS_ARCHIVED = 3;
}
```

- **Auth:** JWT bearer dikirim via header, diverifikasi oleh interceptor Connect di backend (HS256, `AUTH_JWT_SECRET`) — konsep sama seperti `AuthPlugin` sekarang, hanya pindah dari GraphQL context ke Connect interceptor.

### 4.3 Alur handler create (pseudokode Arke)

```rust
// 1. Auth + permission
let user = ctx.require_permission(Projects, Create)?;

// 2. Validasi
let name = req.name.trim();
if name.is_empty() { return Err(invalid_argument("name is required")); }
let owner_id = req.owner_id.unwrap_or(user.id.clone());

// 3. Spawn entity + komponen inti (satu transisi archetype)
let e = world.spawn_bundle((
    ProjectTag,
    ProjectName { value: name.to_string() },
    ProjectOwnerId { value: owner_id.clone() },
    ProjectStatus::Active,
));
if let Some(desc) = req.description.filter(|d| !d.trim().is_empty()) {
    world.insert(e, ProjectDescription { value: desc });
}

// 4. Membership: owner (creator, atau owner_id bila ditunjuk)
ensure_membership(e, &owner_id);
if owner_id != user.id { ensure_membership(e, &user.id); } // pembuat tetap member

// 5. Persist (arke-postgres, sumber kebenaran)
store.save(&world, e)?;

// 6. Kembalikan representasi Project
Ok(project_message(&world, e))
```

## 5. Aturan Perilaku

1. **Owner default = pembuat.** `owner_id` kosong → di-set ke ID pemanggil.
2. **Auto-membership.** Owner selalu jadi member. Bila `owner_id` ditunjuk berbeda dari pembuat, pembuat tetap ditambahkan sebagai member. *(Tidak lagi menambahkan "semua user aktif" seperti `approveProject` legacy.)*
3. **Otoritas owner (ditetapkan di sini, dieksekusi di flow lain).** Owner sebuah projek boleh: kelola member, ubah status, hapus projek, dan **transfer ownership**. Admin (`*`) selalu tercakup. Kontrak & UI aksi-aksi ini hidup di flow list/detail & update — flow create hanya **menetapkan** siapa owner-nya.
4. **Status awal `Active`.** Tanpa approval, tanpa `winStage`.
5. **Tanpa panggilan Core Portal.** Create murni lokal.
6. **Tanpa auto-module.** Projek lahir kosong (tak ada module "Proposal" default). **Dependensi lintas-flow:** flow detail/modules **tidak boleh** mengasumsikan minimal satu module ada — ia harus menangani projek tanpa module (empty state).

## 6. Frontend — Dialog yang Dipoles

Komponen: `apps/frontend/src/components/projects/project-form.tsx` (dipertahankan sebagai dialog, dirapikan).

- **Field:**
  - **Name** — `Input`, autofocus, wajib, di-trim.
  - **Description** — `Textarea`, opsional.
  - **Owner** — `UserCombobox`, opsional (kosong → default pembuat di backend). Menggantikan field "Project Leader".
- **Poles UX:**
  - Tombol *Create* disable saat nama kosong atau saat loading.
  - State loading eksplisit ("Creating…").
  - **Cmd/Ctrl+Enter** submit via `useFormShortcut`.
  - Reset form saat sukses.
- **Data layer (Connect):** flow ini jadi **konsumen Connect pertama** di frontend. Butuh setup bersama yang minimal:
  - Transport Connect (`createConnectTransport`) + interceptor yang menyisipkan `Authorization: Bearer <jwt>` dari `useAuthStore`.
  - Client `ProjectService` ter-generate dari `.proto`.
  - Hook `useCreateProject` membungkus `client.createProject(...)`, mengembalikan `{ mutate, isLoading }` (pola sama seperti hook factory sekarang), memetakan pesan `Project` → tipe frontend flat `Project`.
- **Sukses:** refetch daftar projek lokal, tutup dialog, `navigate('/projects/{id}')` memakai **ID lokal** dari response.

## 7. Model Status

Linear, tanpa `winStage`:

```
Active → Completed → Archived
```

- **Active** — projek berjalan (status awal).
- **Completed** — pekerjaan selesai.
- **Archived** — diarsipkan/disembunyikan.

Transisi antar-status (tombol UI, guard owner/admin) = milik flow list/detail & update, **bukan** flow ini. Config badge (label/warna) disederhanakan dari 8 status turunan menjadi 3.

## 8. Dependensi & Prasyarat (di luar cakupan, tapi memblokir implementasi)

Flow create tidak bisa berdiri sendiri sampai fondasi berikut ada:

1. **Skeleton backend Rust + Arke + arke-postgres** (World, store, migrasi skema Project).
2. **Transport Connect** + interceptor auth (verifikasi JWT) di backend, dan setup `connect-web` + interceptor di frontend.
3. **Operasi pendukung** yang dipakai UI: daftar user (untuk **owner** picker) & daftar projek (untuk refetch) via transport baru — selama transisi, keduanya mungkin masih di jalur lama. Perlu keputusan urutan migrasi.
4. **Model & operasi Membership** di platform baru.

## 9. Di Luar Cakupan

- Fondasi/migrasi platform (Rust/Arke/Connect) — dok tersendiri.
- Migrasi read-path (list/detail/timeline/media) & data projek Core lama.
- Sub-project (dihapus dari model — lihat §1).
- Pembuatan module default.
- `code` projek human-readable.
- Transisi status, edit projek, kelola member, transfer ownership (flow list/detail & update).

## 10. Keputusan Terbuka

1. **`ProjectCoreRef` legacy** dipertahankan (nullable, tak diisi projek baru) selama transisi data lama. — *Usul: ya.*
2. **`code` human-readable projek.** — *Usul: tunda (out of scope).*
3. **Auto-module saat create.** — *Usul: tidak.*
4. **Urutan migrasi** operasi pendukung (users/list) relatif ke flow ini. — *Perlu diputuskan di dok fondasi.*
