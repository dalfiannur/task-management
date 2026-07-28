# Flow: Tab Timeline (Gantt) — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Isi **tab timeline** — Gantt interaktif atas Module & Task: bar per task, panel **Unscheduled**, **reschedule via drag/resize**, dan **zoom day/week/month**. **Tanpa model data baru** — reuse kontrak dari flow all-tasks.
- **Terkait:** [All-Tasks (Modules & Tasks)](./2026-07-29-project-all-tasks-tab-flow-design.md) · [List & Detail-Shell](./2026-07-29-project-list-detail-flow-design.md) · [Fondasi](./2026-07-29-platform-foundation-design.md)

---

## 1. Ringkasan & Prinsip

Timeline adalah **tampilan alternatif** atas data yang sama dengan tab all-tasks (Project → Modules → Tasks), diproyeksikan ke sumbu waktu berdasar `start_date`/`due_date` task.

- **Tidak ada komponen ECS / operasi backend baru.** Baca via `ListModules` + `ListTasks`; reschedule via **`UpdateTask`** (field tanggal). Semua kontrak sudah ada di [flow all-tasks](./2026-07-29-project-all-tasks-tab-flow-design.md).
- **Guard sama seperti task:** melihat = member; mengubah tanggal (drag/resize) = **semua member** (aturan `UpdateTask`).
- **Interaktif:** drag/resize bar & drag dari Unscheduled untuk menjadwalkan.

## 2. Data & Proyeksi

- **Baris:** untuk tiap module (terurut) → baris header module, lalu baris task-task-nya (terurut `order`). Sama struktur seperti sekarang (`TimelineRow`).
- **Bar task:** direntang dari `start_date` s/d `due_date`.
  - Punya **kedua** tanggal → bar membentang start..due.
  - Punya **salah satu** saja → bar **1 hari** di tanggal itu.
  - **Tak punya keduanya** → **tidak** jadi bar; masuk **Unscheduled** (§4).
- **Range waktu:** auto dari min(start) hingga max(due) seluruh task + padding; bila kosong, default jendela ±2 minggu dari hari ini (seperti `computeTimelineRange` sekarang).
- **Guard baca:** non-member → `PERMISSION_DENIED` dari `ListTasks`/`ListModules`.

## 3. Interaksi Reschedule (drag/resize)

Semua aksi memanggil **`UpdateTask`** (guard: member). UI optimistik lalu sinkron dari response.

| Gestur | Efek | Aturan |
|---|---|---|
| **Geser seluruh bar** | Menggeser `start_date` **dan** `due_date` dengan delta sama (**durasi dipertahankan**). | Bila task hanya punya satu tanggal, geser tanggal itu saja. |
| **Tarik ujung kiri** | Ubah `start_date` saja. | Clamp `start_date ≤ due_date` (bila due ada). |
| **Tarik ujung kanan** | Ubah `due_date` saja. | Clamp `due_date ≥ start_date` (bila start ada). |
| **Drag dari Unscheduled ke grid** | Set `start_date` = posisi drop; `due_date` = start + **durasi default** (§8). | Task pindah dari panel Unscheduled ke baris module-nya. |

- **Snapping** ke unit skala aktif (hari/minggu/bulan).
- **Konflik guard:** non-member yang entah bagaimana men-drag → backend tolak `PERMISSION_DENIED`; UI rollback optimistik.
- **Tidak mengubah module/order** — itu ranah `MoveTask` di tab all-tasks; timeline hanya menyentuh tanggal.

## 4. Panel Unscheduled

- Daftar task **tanpa `start_date` & `due_date`**, dikelompokkan per module.
- **Drag ke grid** → menjadwalkan (lihat §3). Setelah punya tanggal, task hilang dari panel dan muncul sebagai bar.
- Bila interaktivitas dinonaktifkan untuk user (mis. bukan member), panel tetap tampil read-only tanpa drag.
- **Empty state:** semua task terjadwal → panel kosong/ tersembunyi.

## 5. Zoom (day / week / month)

- Kontrol skala: **Day** (grid harian + header minggu — default), **Week** (kolom per minggu), **Month** (kolom per bulan).
- Perhitungan posisi/lebar bar (`computeBarPosition*`) diparametrikan oleh **unit + lebar-unit** aktif, bukan `DAY_WIDTH` tetap.
- Header grid menyesuaikan label (hari/minggu/bulan). Snapping drag mengikuti unit aktif.
- Skala disimpan di UI store (mis. `ui-store`) atau state lokal tab.

## 6. Frontend

Komponen di `src/components/timeline/` (dipertahankan, dikembangkan). Migrasi CSS Module → **Tailwind** saat disentuh (komponen grid kompleks — boleh bertahap).

- **`gantt-chart.tsx`** — orkestrasi: fetch `useModules` + `useTasks(project)`, susun rows, hitung range & skala, render panel + grid + Unscheduled.
- **`gantt-timeline-grid.tsx`** — grid waktu + bar; menangani **drag/resize** → `useUpdateTask`.
- **`gantt-task-panel.tsx`** — kolom kiri (nama module/task) + **panel Unscheduled** dengan drag source.
- **`timeline-utils.ts`** — generalisasi: `computeTimelineRange`, `computeBarPosition(unit, unitWidth, ...)`, `groupDaysBy(scale)`, util snapping.
- **Kontrol zoom** (Day/Week/Month) di toolbar tab.
- **Hooks:** hanya konsumen — `useModules`, `useTasks`, `useUpdateTask` (dari flow all-tasks). Tak ada hook baru khusus timeline selain util.

## 7. Di Luar Cakupan

- **Dependency/link antar-task**, milestone, critical path.
- **Edit selain tanggal** (title/assignee/status) — lewat dialog task di all-tasks.
- **Reorder module/order via timeline** — ranah all-tasks (`MoveTask`).
- Ekspor (PNG/PDF), print, baseline/plan-vs-actual.

## 8. Keputusan Terbuka (usul)

1. **Durasi default saat menjadwalkan dari Unscheduled.** — *Usul: 1 hari (start = due = tanggal drop); user lalu resize.*
2. **Preserve-duration saat geser bar** vs geser hanya start. — *Usul: preserve-duration (geser keduanya).*
3. **Penanganan task 1-tanggal** (hanya start atau hanya due) sebagai bar 1 hari. — *Usul: ya; resize menambah tanggal kedua.*
4. **Debounce/commit drag** — commit `UpdateTask` saat drop (bukan tiap frame). — *Usul: commit on drop, optimistik selama drag.*
5. **Persistensi pilihan zoom** (global vs per-projek). — *Usul: state lokal tab dulu.*
