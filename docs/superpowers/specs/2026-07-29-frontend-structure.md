# Struktur Folder Frontend — Re-Platform

- **Tanggal:** 2026-07-29
- **Status:** Keputusan
- **Cakupan:** Tata letak `apps/frontend/src/` untuk stack baru (TanStack Router file-based · TanStack Query + `@connectrpc/connect-query` · Jotai · proto ter-generate). **Feature-based.**
- **Terkait:** [Tech Stack](./2026-07-29-tech-stack-decisions.md) · [`.proto`](../proto/sedjiwa_tasks.v1.proto) · [README](../README.md)

---

## 1. Prinsip

- **Feature-based:** kolokasi UI + data + state per domain di `features/<domain>/`. Memetakan 1:1 ke dok flow.
- **Routes tipis:** `routes/` (file-based TanStack Router) hanya parsing param + guard + memanggil komponen fitur. Logika ada di `features/`.
- **Data per-fitur:** tiap fitur punya `api/` berisi `queryOptions`/mutation connect-query + mapper proto→tipe FE.
- **Import lewat barrel:** fitur mengekspos `index.ts`; lintas-fitur impor dari `@/features/<x>` (hindari deep-import).

## 2. Pohon

```
apps/frontend/src/
├── main.tsx                      # bootstrap: Jotai Provider, QueryClientProvider, TransportProvider, RouterProvider
├── routeTree.gen.ts              # DIGENERATE (@tanstack/router-plugin) — jangan edit tangan
├── routes/                       # TanStack Router file-based (TIPIS → impor dari features/)
│   ├── __root.tsx                # root: providers/devtools, context { queryClient, auth }
│   ├── login.tsx
│   ├── register.tsx
│   ├── _authed.tsx               # layout + beforeLoad guard (tanpa token → /login?redirect=…)
│   ├── _authed/
│   │   ├── dashboard.tsx
│   │   ├── my-tasks.tsx
│   │   ├── settings.tsx
│   │   ├── projects/
│   │   │   ├── index.tsx         # list projek
│   │   │   ├── $projectId.tsx    # SHELL detail (header + tab nav + <Outlet/>)
│   │   │   └── $projectId/
│   │   │       ├── all-tasks.tsx
│   │   │       ├── timeline.tsx
│   │   │       ├── members.tsx
│   │   │       ├── media.tsx
│   │   │       ├── pages/index.tsx
│   │   │       └── pages/$pageId.tsx   # editor
│   │   └── admin/
│   │       └── users.tsx         # beforeLoad tambahan: cek isAdmin
├── features/
│   ├── auth/          { api/  atoms/  components/  types.ts  index.ts }
│   ├── users/         # direktori + admin CRUD + UserCombobox
│   ├── projects/      # create dialog, list, detail-shell header, aksi owner
│   ├── tasks/         # modules + tasks (ModuleSection, TaskRow, TaskDialog, DnD)
│   ├── timeline/      # gantt (drag/resize, unscheduled, zoom)
│   ├── members/
│   ├── pages/         # wiki: list + editor markdown
│   ├── media/         # file manager + upload presigned
│   ├── labels/        # LabelCombobox + palette
│   ├── comments/      # thread + composer @mention
│   ├── notifications/ # bell + stream (client Connect mentah) + atoms
│   ├── activity/      # daftar activity (per-task, feed)
│   └── dashboard/     # stat cards + my-tasks (3 view)
├── components/
│   ├── ui/                        # shadcn/ui primitives (shared)
│   └── shared/                    # lintas-fitur: PropertyRow, DatePickerField, dsb.
├── lib/
│   ├── connect.ts                 # createConnectTransport(baseUrl:/api/tasks-rs) + interceptor auth
│   ├── query.ts                   # QueryClient + helper invalidasi
│   └── utils.ts                   # cn, getInitials, dll.
├── gen/                           # OUTPUT buf: sedjiwa_tasks_pb.ts (+ connect-query)
├── styles/
└── index.css
```

## 3. Konvensi Isi Fitur (`features/<domain>/`)

| Sub | Isi |
|---|---|
| `api/` | `queryOptions`/mutation connect-query per-RPC + **mapper** pesan proto → tipe FE flat + helper query-key/invalidasi. |
| `components/` | UI khusus fitur (dialog, list, row, editor). |
| `atoms/` | Jotai — **hanya bila perlu** (auth, notifications unread/stream, UI lokal). |
| `types.ts` | Tipe FE flat (hasil map dari `gen/`). |
| `index.ts` | Barrel: ekspor komponen + api publik fitur. |

## 4. Data Layer (connect-query + TanStack)

- **`lib/connect.ts`:** `createConnectTransport({ baseUrl: "/api/tasks-rs", interceptors: [authInterceptor] })`. `authInterceptor` membaca token dari **atom auth** (via `getDefaultStore().get(authAtom)` — bukan hook), disisipkan `Authorization: Bearer`.
- **`lib/query.ts`:** `QueryClient`; `main.tsx` memasang `TransportProvider` (connect-query) + `QueryClientProvider`.
- **Per-fitur `api/`:** mis. `features/projects/api/list.ts` → `listProjectsOptions(input)` memakai `createQueryOptions(ListProjects, input, { transport })`. Komponen: `useQuery(listProjectsOptions(...))`.
- **Mutation:** `useMutation` connect-query + `onSuccess` → invalidasi query-key terkait (mis. setelah `CreateTask` → invalidasi `ListTasks(projectId)`).
- **Prefetch (opsional):** route `loader` boleh `queryClient.ensureQueryData(options)` untuk data kritis shell.
- **Streaming (`StreamNotifications`):** **tidak** lewat connect-query — `features/notifications/` buka stream dgn **client Connect mentah**, tulis ke atom Jotai; fallback polling `UnreadCount` via TanStack Query.

## 5. Routing & Guard (TanStack Router)

- **File-based** via `@tanstack/router-plugin` (Vite) → `routeTree.gen.ts`.
- **Context router:** `{ queryClient, auth }` di-inject di `__root`.
- **`_authed.tsx` `beforeLoad`:** tanpa token → `redirect({ to: '/login', search: { redirect: location.href } })`.
- **Admin:** `admin/users.tsx` `beforeLoad` cek `isAdmin`; jika bukan → redirect/403.
- **Shell projek** (`$projectId.tsx`): fetch projek (`GetProject`), render header + tab nav + `<Outlet/>`; tab = child routes.

## 6. State (Jotai)

- `features/auth/atoms/`: `authAtom = atomWithStorage('auth', { token, user, isAdmin })`; turunan `isAdminAtom`, `tokenAtom`.
- `features/notifications/atoms/`: `unreadCountAtom`, buffer stream.
- UI global (sidebar, view-mode, zoom timeline): atom kecil di fitur terkait atau `lib`/`atoms` bila benar-benar lintas-fitur.

## 7. Migrasi dari Struktur Lama (peta)

| Lama | Baru |
|---|---|
| `pages/*.tsx` (React Router) | `routes/**` tipis + `features/*/components` |
| `hooks/use-*.ts` (GraphQL manual) + `lib/hook-factories.ts` + `lib/graphql-client.ts` | `features/*/api/*` (connect-query) + `lib/connect.ts` + `gen/` |
| `stores/*.ts` (Zustand) | `features/*/atoms/*` (Jotai) |
| `components/{domain}/` | `features/{domain}/components/` |
| `components/{ui,shared}/` | tetap `components/{ui,shared}/` |
| `types/*.ts` | `features/*/types.ts` (+ shared tetap) |
| `company-store.ts`, `use-leads/companies/divisions` | **dihapus** (sales) |

- **Alias tetap** `@/*` → `src/*`.

## 8. Keputusan Terbuka (usul)

1. **Barrel `index.ts` per fitur** vs impor path langsung. — *Usul: barrel untuk lintas-fitur; internal boleh langsung.*
2. **Devtools** (TanStack Router/Query) di dev. — *Usul: aktif di dev.*
3. **Route loader prefetch** vs fetch di komponen. — *Usul: prefetch hanya untuk data shell kritis; selebihnya di komponen.*
4. **Lokasi atom UI global** (fitur vs `lib`). — *Usul: fitur; naikkan ke `lib` hanya bila dipakai ≥3 fitur.*
