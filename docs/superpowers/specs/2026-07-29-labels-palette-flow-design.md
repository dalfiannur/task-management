# Flow: Labels Palette — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Palette **Label** per-projek — buat/edit/hapus label + assign ke task. Task me-*refer* label via `label_ids` (didefinisikan di [all-tasks](./2026-07-29-project-all-tasks-tab-flow-design.md)).
- **Terkait:** [All-Tasks](./2026-07-29-project-all-tasks-tab-flow-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Label = **kosakata bersama** untuk mengkategorikan task dalam satu projek (nama + warna). Kolaboratif dan ringan.

- **Per-projek.** Label milik satu projek; tak lintas-projek.
- **Kolaboratif:** **semua member** boleh buat/edit/hapus (dibuat sambil kerja).
- **Hapus toleran:** menghapus label **tidak** menyentuh task; `label_id` yang menggantung diabaikan frontend (sesuai keputusan "longgar" di all-tasks §8).

## 2. Model Data — ECS Arke

| Komponen | Field | Semantik |
|---|---|---|
| `LabelTag` | — | Penanda entity label. |
| `LabelInfo` | `project_id: String` `#[pg(index)]`, `name: String` `#[pg(index)]`, `color: String` | Nama + warna (hex). |

```rust
#[derive(Component)] struct LabelTag;
#[derive(Component)]
struct LabelInfo {
    #[pg(index)] project_id: String,
    #[pg(index)] name: String,
    color: String, // hex, mis. "#4f46e5"
}
```

## 3. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.label.v1;

service LabelService {
  rpc ListLabels(ListLabelsRequest) returns (ListLabelsResponse);
  rpc CreateLabel(CreateLabelRequest) returns (Label);
  rpc UpdateLabel(UpdateLabelRequest) returns (Label);
  rpc DeleteLabel(DeleteLabelRequest) returns (DeleteLabelResponse);
}

message Label { string id = 1; string project_id = 2; string name = 3; string color = 4; }

message ListLabelsRequest { string project_id = 1; }
message ListLabelsResponse { repeated Label labels = 1; }
message CreateLabelRequest { string project_id = 1; string name = 2; string color = 3; }
message UpdateLabelRequest { string id = 1; optional string name = 2; optional string color = 3; }
message DeleteLabelRequest { string id = 1; }
message DeleteLabelResponse { bool ok = 1; }
```

## 4. Aturan & Guard

| Operasi | Siapa boleh | Aturan |
|---|---|---|
| `ListLabels` | member atau admin | `project_id` harus projek tempat user member. |
| `CreateLabel` | **semua member** | `name` non-kosong, `color` hex valid. |
| `UpdateLabel` | **semua member** | Field absen = tak diubah. |
| `DeleteLabel` | **semua member** | Hapus **hanya** entity label. `label_id` yang menggantung di task **diabaikan** (tak ada cascade). |

- **Keunikan:** nama label boleh duplikat dalam projek (tak dipaksa unik); UI boleh memperingatkan.
- **Validasi warna:** hex `#RRGGBB`; nilai tak valid → `INVALID_ARGUMENT`.

## 5. Frontend

- **`LabelCombobox`** (`src/components/shared/label-combobox.tsx`) — pilih label untuk task; **inline create** (ketik nama baru + pilih warna → `CreateLabel`).
- **Manajemen label:** edit/hapus label lewat combobox (aksi per-baris) atau panel kecil; palet warna preset + custom hex.
- **Rendering:** chip berwarna di TaskRow & dialog task; frontend **memfilter** `label_ids` yang tak ada di daftar label projek (toleran terhadap dangling).
- **Hooks (Connect):** `useLabels(projectId)`, `useCreateLabel`, `useUpdateLabel`, `useDeleteLabel`. Tipe flat `Label`.

## 6. Di Luar Cakupan

- **Cascade cleanup** `label_id` dari task saat hapus (lihat §7 no.1).
- **Label lintas-projek / global**, grup label, ikon label.
- **Filter task by label** di list/board — ranah flow filter.

## 7. Keputusan Terbuka (usul)

1. **Cascade vs toleran saat hapus.** — *Sudah diputuskan: toleran (tanpa cascade). Bisa ditambah cascade nanti bila daftar dangling mengganggu.*
2. **Keunikan nama** per projek. — *Usul: tidak dipaksa; peringatan UI saja.*
3. **Palet warna preset** vs bebas. — *Usul: preset + opsi custom hex.*
