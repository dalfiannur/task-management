# Sedjiwa Task Management — Desain Re-Platform (Rust + Arke + Connect)

Titik masuk untuk seluruh dokumen desain re-platform per **2026-07-29**.

**Arah besar:** tulis ulang backend **Bun/bunsane + GraphQL → Rust + Arke (ECS) + arke-postgres + gRPC/Connect** (big-bang, dibangun bertahap). Frontend React tetap, transport pindah ke **`@connectrpc/connect-web`**. Model produk disederhanakan menjadi **delivery murni** (buang konsep sales), **owner tunggal + otoritas**, **tanpa sub-project**.

## Mulai dari sini

1. **[Keputusan Tech Stack](./specs/2026-07-29-tech-stack-decisions.md)** — library/tool final (backend Rust + frontend TanStack/Jotai). **Men-supersede** penyebutan lib di dok flow.
2. **[Peta Dependensi & Urutan Implementasi](./specs/2026-07-29-implementation-order.md)** — graf + urutan build (fase 0–9).
3. **[Kontrak gabungan `sedjiwa_tasks.v1.proto`](./proto/sedjiwa_tasks.v1.proto)** — semua service/message dalam satu package.

## Fondasi & Rencana

| Dok | Isi |
|---|---|
| [Platform Foundation (spec)](./specs/2026-07-29-platform-foundation-design.md) | Walking skeleton: Rust + Arke (hybrid cache) + arke-postgres + Axum/connectrpc-axum + interceptor JWT. |
| [Platform Foundation (plan)](./plans/2026-07-29-platform-foundation.md) | 11 task TDD untuk skeleton. |

## Identitas

| Dok | Isi |
|---|---|
| [Users & Auth](./specs/2026-07-29-users-auth-flow-design.md) | Phone+password (Argon2id), JWT issuance, direktori user + admin. |

## Projek

| Dok | Isi |
|---|---|
| [Membuat Projek](./specs/2026-07-29-create-project-flow-design.md) | Model Project lokal, owner-model, create dialog. |
| [List & Detail-Shell](./specs/2026-07-29-project-list-detail-flow-design.md) | List member-scoped + shell detail (header, tab, aksi owner). |

## Tab Detail

| Dok | Isi |
|---|---|
| [All-Tasks (Modules & Tasks)](./specs/2026-07-29-project-all-tasks-tab-flow-design.md) | Module (owner/admin) + Task (member), DnD, dialog task. |
| [Timeline (Gantt)](./specs/2026-07-29-project-timeline-tab-flow-design.md) | Gantt interaktif (reschedule via UpdateTask), unscheduled, zoom. |
| [Members](./specs/2026-07-29-project-members-tab-flow-design.md) | Membership biner, owner-derived, add/remove/leave/transfer. |
| [Pages (Wiki)](./specs/2026-07-29-project-pages-tab-flow-design.md) | Wiki Markdown project-level, kolaboratif. |
| [Media (File Manager)](./specs/2026-07-29-project-media-tab-flow-design.md) | Upload presigned S3, folded ke Rust, link ke task. |

## Pendukung Lintas-Projek

| Dok | Isi |
|---|---|
| [Labels Palette](./specs/2026-07-29-labels-palette-flow-design.md) | Label per-projek, member-kolaboratif, hapus toleran. |
| [Comments](./specs/2026-07-29-comments-flow-design.md) | Markdown + @mention; edit penulis, hapus penulis/owner/admin. |
| [Notifications](./specs/2026-07-29-notifications-flow-design.md) | In-app + real-time (Connect server-streaming); 5 tipe event. |
| [Activity Feed](./specs/2026-07-29-activity-feed-flow-design.md) | Audit log menyeluruh (task/module/member/page/media). |
| [Dashboard & My-Tasks](./specs/2026-07-29-dashboard-my-tasks-flow-design.md) | Agregasi lintas-projek (stats, progress, deadline, recent). |

## Konvensi lintas-dok

- **Guard:** member / owner / admin — dijaga backend; UI hanya cermin.
- **Kontrak dua-lapis:** domain (agnostik) + binding Connect (`.proto`).
- **Emit cross-cutting:** mutasi meng-emit **Activity** (audit) & **Notifications** (jika relevan) sebagai side-effect setelah sukses.
- **Keputusan terbuka terpusat** (cache hasil-query, fan-out multi-instance, generalisasi Store, migrasi data) → lihat [urutan implementasi §3](./specs/2026-07-29-implementation-order.md#3-keputusan-terbuka-lintas-flow-terpusat).
- Bila cuplikan `.proto` per-dok berbeda dari [`sedjiwa_tasks.v1.proto`](./proto/sedjiwa_tasks.v1.proto), **file gabungan yang menang**.
