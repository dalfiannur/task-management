# Flow: Tab Members Projek — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Isi **tab Members** di shell detail projek — daftar anggota, tambah, hapus, keluar sendiri (self-leave), dan jadikan-owner (transfer). Direktori user (sumber picker) & notifikasi = di luar cakupan.
- **Terkait:** [Create Projek](./2026-07-29-create-project-flow-design.md) · [List & Detail-Shell](./2026-07-29-project-list-detail-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Tab Members mengelola **siapa anggota** sebuah projek. Konsisten dengan model **owner tunggal + otoritas**:

- **Membership biner.** Sebuah baris membership = `(projectId, userId)`. **Tidak ada field role.**
- **Owner diturunkan, bukan role.** Owner ditentukan oleh `ProjectOwnerId` di entity projek. Di UI, member yang `userId == owner_id` diberi badge **Owner**.
- **Owner selalu member** dan **tidak bisa dihapus/keluar** — harus **transfer ownership** dulu.

## 2. Model Data — ECS Arke

Port dari `ProjectMembership` yang ada (biner, tanpa role):

| Komponen | Field | Semantik |
|---|---|---|
| `ProjectMembershipTag` | — (marker) | Menandai entity sebagai baris membership. |
| `ProjectMembershipData` | `project_id: String` `#[pg(index)]`, `user_id: String` `#[pg(index)]` | Pasangan projek↔user. Kombinasi unik. |

```rust
#[derive(Component)]
struct ProjectMembershipTag;

#[derive(Component)]
struct ProjectMembershipData {
    #[pg(index)]
    project_id: String,
    #[pg(index)]
    user_id: String,
}
```

- **Keunikan:** satu `(project_id, user_id)` maksimal satu baris. `ensure_membership` bersifat **idempoten** (cek dulu, insert bila belum ada) — bisa diperkuat dengan `#[pg(unique)]` komposit bila didukung.
- **Owner** tidak disimpan di membership; ia `ProjectOwnerId` pada projek (dok create).

## 3. Kontrak Backend (domain + Connect)

Menambah operasi ke `ProjectService`. (`TransferProjectOwnership` sudah didefinisikan di dok list/detail — dipakai ulang untuk "make owner".)

```proto
service ProjectService {
  // ... Create / List / Get / SetStatus / TransferProjectOwnership / Delete ...
  rpc ListProjectMembers(ListProjectMembersRequest) returns (ListProjectMembersResponse);
  rpc AddProjectMember(AddProjectMemberRequest) returns (ListProjectMembersResponse);
  rpc RemoveProjectMember(RemoveProjectMemberRequest) returns (ListProjectMembersResponse);
  rpc LeaveProject(LeaveProjectRequest) returns (LeaveProjectResponse);
}

message Member {
  string user_id = 1;
  bool is_owner = 2; // = (user_id == project.owner_id)
}

message ListProjectMembersRequest { string project_id = 1; }
message ListProjectMembersResponse {
  repeated Member members = 1;
  string owner_id = 2;
}

message AddProjectMemberRequest { string project_id = 1; string user_id = 2; }
message RemoveProjectMemberRequest { string project_id = 1; string user_id = 2; }

message LeaveProjectRequest { string project_id = 1; } // user = pemanggil
message LeaveProjectResponse { bool ok = 1; }
```

> Mutasi member mengembalikan `ListProjectMembersResponse` (daftar terbaru) agar frontend tak perlu refetch terpisah.

## 4. Aturan & Guard

| Operasi | Siapa boleh | Aturan tambahan |
|---|---|---|
| `ListProjectMembers` | member atau admin | Non-member non-admin → `PERMISSION_DENIED`. |
| `AddProjectMember` | owner atau admin | Idempoten: sudah member → no-op sukses. `user_id` harus user valid. |
| `RemoveProjectMember` | owner atau admin | **Tidak boleh menghapus owner** → `FAILED_PRECONDITION` ("transfer ownership dulu"). Bukan member → no-op sukses. |
| `LeaveProject` | member itu sendiri | Owner **tidak bisa** leave → `FAILED_PRECONDITION`. |
| "Make owner" (`TransferProjectOwnership`) | owner atau admin | `new_owner_id` di-auto-add jadi member bila belum; `ProjectOwnerId` dipindah; owner lama jadi member biasa. |

- **Invarian:** selalu ada tepat **satu owner**, dan owner **selalu** punya baris membership. Karena owner tak bisa dihapus/leave, projek tak pernah kehilangan owner/member.

## 5. Frontend — Tab Members (`project-members.tsx` ditulis ulang)

- **Migrasi styling:** buang `project-members.module.css`, pakai **Tailwind** (sesuai konvensi repo saat menyentuh file).
- **Daftar member:** grid/list kartu. Tiap kartu: avatar + nama (dari direktori user), badge **Owner** bila `is_owner`.
- **Tambah member:** `UserCombobox` (exclude yang sudah member) + tombol Add → `AddProjectMember`. Terlihat hanya untuk owner/admin.
- **Hapus member:** tombol X pada kartu → `RemoveProjectMember`. Disembunyikan untuk kartu owner dan untuk non-owner/non-admin.
- **Self-leave:** bila pemanggil adalah member non-owner, tampilkan tombol **"Leave project"** → `LeaveProject` → navigate ke `/projects`.
- **Make owner:** aksi pada kartu member (mis. menu) "Jadikan owner" → `TransferProjectOwnership` (konfirmasi). Terlihat hanya untuk owner/admin, dan tidak pada kartu owner.
- **Hooks (Connect):** `useProjectMembers`, `useAddProjectMember`, `useRemoveProjectMember`, `useLeaveProject`, `useTransferOwnership` (bersama detail-shell). Semua mengembalikan/menyegarkan daftar member terbaru.
- **Guard UI** mengikuti §4; sumber kebenaran tetap guard backend.

## 6. Di Luar Cakupan

- **Direktori user** (sumber `UserCombobox`) & pencarian user — dok users/auth.
- **Notifikasi** saat ditambah/dihapus/di-transfer.
- **Role** selain owner/member (mis. editor/viewer) — tidak ada; bisa ditambah sengaja nanti.
- **Undangan user eksternal** / pending invite — tidak ada; hanya user yang sudah ada di direktori.

## 7. Keputusan Terbuka (usul)

1. **Keunikan membership** via `#[pg(unique)]` komposit vs cek-lalu-insert. — *Usul: pakai unique bila arke-postgres mendukung; jika tidak, cek-lalu-insert idempoten.*
2. **`LeaveProject` untuk admin non-member.** — *Usul: admin tak "leave" (ia bukan member); aksi admin = Remove.*
3. **Konfirmasi transfer ownership** (dialog) wajib. — *Usul: ya, karena mengalihkan otoritas.*
