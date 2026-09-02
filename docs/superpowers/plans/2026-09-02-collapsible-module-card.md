# Collapsible Module Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiap Module Card di tab All Tasks bisa dilipat, dan keadaannya diingat per browser per project.

**Architecture:** Satu atom Jotai ber-localStorage menyimpan id module yang terlipat per project; `ModuleSection` membungkus badannya dengan primitif `Collapsible` Radix yang sudah ter-vendor, dan ref droppable dnd-kit pindah ke elemen `<section>` supaya module tetap jadi tujuan drag meski sedang terlipat.

**Tech Stack:** React 19, Jotai (`atomWithStorage`), Radix Collapsible via `components/ui/collapsible.tsx`, dnd-kit, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-02-collapsible-module-card-design.md`

---

## Catatan penting sebelum mulai

**Frontend proyek ini tidak punya framework test.** Gerbang otomatisnya hanya
`bun run tsc --noEmit`, `bun run lint`, dan `bun run build`. Ketiganya tidak akan
menangkap satu pun bug yang mungkin muncul di sini — semuanya soal perilaku
runtime. Karena itu Task 3 adalah verifikasi manual di browser, dan **ia bagian
wajib dari rencana ini, bukan pelengkap.**

Ini bukan kehati-hatian teoretis: pekerjaan MCP yang baru selesai di repo ini
menemukan dua bug nyata di halaman token yang lolos dari ketiga gerbang itu *dan*
dari tiga kali code review, karena keduanya bug siklus-hidup React yang hanya
muncul saat dijalankan.

Semua perintah dijalankan dari `apps/frontend/`.

## File Structure

**Dibuat:**

| File | Tanggung jawab |
|---|---|
| `src/features/tasks/atoms/collapsed-modules.ts` | Atom persisten + hook `useModuleCollapsed` untuk satu module card |

**Diubah:**

| File | Perubahan |
|---|---|
| `src/features/tasks/components/module-section.tsx` | Bungkus badan dengan `Collapsible`, tambah chevron trigger, pindahkan ref droppable ke `<section>` |

`all-tasks-tab.tsx` **tidak** perlu diubah — `ModuleSection` sudah menerima
`projectId` dan `module`, yang keduanya sudah cukup untuk hook-nya.

---

## Task 1: Atom keadaan terlipat

**Files:**
- Create: `apps/frontend/src/features/tasks/atoms/collapsed-modules.ts`

Feature `tasks` belum punya direktori `atoms/`; `CLAUDE.md` bilang atom dibuat
hanya ketika memang dibutuhkan, dan ini kasusnya.

- [ ] **Step 1: Tulis atom dan hook-nya**

Buat `apps/frontend/src/features/tasks/atoms/collapsed-modules.ts`:

```typescript
// Which module cards are collapsed, per project (Jotai + localStorage).
//
// Stores the *collapsed* ids rather than the expanded ones, so a module that
// didn't exist when the value was written defaults to open. A module created
// tomorrow shows up visible instead of being born hidden.

import { useCallback } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const STORAGE_KEY = "sedjiwa.modules.collapsed";

/** projectId → ids of the modules collapsed in that project. */
export const collapsedModulesAtom = atomWithStorage<Record<string, string[]>>(
  STORAGE_KEY,
  {},
  undefined,
  // Read localStorage synchronously at init, the same reason `sessionAtom`
  // does: without it every module renders open on a fresh page load and then
  // snaps shut once an effect hydrates — a visible flash on exactly the
  // modules the user chose to hide.
  { getOnInit: true },
);

/** `[collapsed, setCollapsed]` for one module card. */
export function useModuleCollapsed(
  projectId: string,
  moduleId: string,
): readonly [boolean, (next: boolean) => void] {
  const [byProject, setByProject] = useAtom(collapsedModulesAtom);
  const collapsed = (byProject[projectId] ?? []).includes(moduleId);

  const setCollapsed = useCallback(
    (next: boolean) =>
      setByProject((prev) => {
        const current = prev[projectId] ?? [];
        if (next === current.includes(moduleId)) return prev;
        return {
          ...prev,
          [projectId]: next
            ? [...current, moduleId]
            : current.filter((id) => id !== moduleId),
        };
      }),
    [projectId, moduleId, setByProject],
  );

  return [collapsed, setCollapsed] as const;
}
```

Perhatikan `if (next === current.includes(moduleId)) return prev;` — mengembalikan
objek yang sama saat tidak ada perubahan mencegah penulisan localStorage dan
render ulang yang percuma.

- [ ] **Step 2: Ekspor lewat barrel**

Di `apps/frontend/src/features/tasks/index.ts`, tambahkan di dekat ekspor lain:

```typescript
export { useModuleCollapsed } from "./atoms/collapsed-modules";
```

`collapsedModulesAtom` sendiri sengaja **tidak** diekspor dari barrel — tidak ada
yang di luar feature ini yang perlu menyentuh bentuk penyimpanannya, dan hook-nya
adalah satu-satunya cara yang benar untuk memakainya.

- [ ] **Step 3: Jalankan gerbang**

Run: `bun run tsc --noEmit`
Expected: bersih, tanpa output.

Run: `bun run lint`
Expected: 0 error. Dua peringatan `react-hooks/exhaustive-deps` di
`pages-tab.tsx` dan `all-tasks-tab.tsx` sudah ada sebelumnya dan bukan urusanmu —
pastikan tidak muncul peringatan **ketiga** dari file barumu.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/tasks/atoms/collapsed-modules.ts \
        apps/frontend/src/features/tasks/index.ts
git commit -m "feat(tasks): remember which module cards are collapsed"
```

---

## Task 2: Lipat Module Card

**Files:**
- Modify: `apps/frontend/src/features/tasks/components/module-section.tsx`

- [ ] **Step 1: Tambah impor**

Di bagian impor `module-section.tsx`:

- Tambahkan `ChevronRight` ke impor `lucide-react` yang sudah ada (`ChevronDown`,
  `ChevronUp`, `Pencil`, `Plus`, `Trash2` tetap).
- Tambahkan:

```typescript
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useModuleCollapsed } from "../atoms/collapsed-modules";
```

- [ ] **Step 2: Baca keadaan terlipat**

Di dalam badan komponen, di dekat `useState`/`useDroppable` yang sudah ada:

```typescript
const [collapsed, setCollapsed] = useModuleCollapsed(projectId, module.id);
```

- [ ] **Step 3: Pindahkan ref droppable ke `<section>`, bungkus dengan `Collapsible`**

Ganti `<section>` pembuka. Sebelum:

```tsx
    <section className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
```

Sesudah:

```tsx
    {/* `asChild` supaya Collapsible tidak menambah elemen pembungkus dan
        `<section>` tetap jadi kotak kartu yang sama seperti sebelumnya. */}
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      asChild
    >
      {/* Droppable-nya ada di `<section>`, bukan di daftar task, supaya module
          tetap jadi tujuan drag saat terlipat — kalau tidak, melipat sebuah
          module diam-diam menghapusnya sebagai tujuan pemindahan task. */}
      <section
        ref={setNodeRef}
        className="overflow-hidden rounded-xl bg-surface-raised shadow-2"
      >
```

Dan tutup dengan `</section></Collapsible>` di akhir komponen, menggantikan
`</section>` yang sekarang.

- [ ] **Step 4: Tambahkan chevron trigger di header**

Sebagai anak **pertama** `<header>`, sebelum `<h3>`:

```tsx
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 h-7 w-7 [&[data-state=open]>svg]:rotate-90"
            aria-label={`Toggle ${module.name}`}
          >
            <ChevronRight className="h-4 w-4 transition-transform" />
          </Button>
        </CollapsibleTrigger>
```

Dua hal yang disengaja di sini:

- **`ChevronRight` yang berputar, bukan chevron atas/bawah.** Header ini sudah
  punya `ChevronUp` dan `ChevronDown` di kanan untuk mengurutkan module; chevron
  atas/bawah ketiga akan terbaca sebagai kendali urutan lagi.
- **Trigger-nya di luar blok `canManage`.** Melipat bukan tindakan mengelola —
  semua orang yang bisa melihat project boleh melipat kartunya.

`aria-expanded` dan `aria-controls` dipasang Radix sendiri; jangan menuliskannya
manual. Label-nya sengaja **statis** dan menyebut nama module, bukan berubah-ubah
antara "Expand"/"Collapse": keadaannya sudah diumumkan `aria-expanded`, jadi label
yang ikut berubah membuatnya terdengar dua kali — sementara nama module justru
yang membedakan tombol ini dari chevron di kartu lain di layar yang sama.

- [ ] **Step 5: Bungkus badan dengan `CollapsibleContent`**

Bungkus **dua** blok yang sudah ada — div daftar task dan `<form>` quick-add —
dalam satu `<CollapsibleContent>`, tepat setelah `</header>`:

```tsx
      </header>

      <CollapsibleContent>
        <div className="min-h-[0.5rem]">
          {/* SortableContext + TaskRow seperti sekarang, tidak diubah */}
        </div>

        <form
          onSubmit={addTask}
          className="flex items-center gap-2 border-t border-border-subtle px-4 py-2"
        >
          {/* isi form seperti sekarang, tidak diubah */}
        </form>
      </CollapsibleContent>
```

Perhatikan `ref={setNodeRef}` **dihapus** dari div daftar task (sudah pindah ke
`<section>` di Step 3), tapi `className="min-h-[0.5rem]"` tetap — itu yang memberi
module kosong area jatuh yang bisa disasar.

Form quick-add ikut masuk ke dalam `CollapsibleContent` karena ia bagian dari isi
module; module "terlipat" yang masih menerima input akan terasa setengah jalan.

- [ ] **Step 6: Jalankan gerbang**

Run: `bun run tsc --noEmit`
Expected: bersih.

Run: `bun run lint`
Expected: 0 error, tidak ada peringatan baru.

Run: `bun run build`
Expected: sukses.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/tasks/components/module-section.tsx
git commit -m "feat(tasks): collapse a module card from its header"
```

---

## Task 3: Verifikasi manual di browser

**Files:** tidak ada yang diubah kecuali perbaikan yang ditemukan.

Ini gerbang sesungguhnya. Ketiga perintah di Task 1 dan 2 tidak membuktikan satu
pun perilaku di bawah ini.

- [ ] **Step 1: Jalankan aplikasinya**

Port **3010**, **3012** dan **3001** sedang dipakai container lain di mesin ini —
pilih port lain untuk backend dan frontend, dan pastikan proxy frontend menunjuk
ke port backend yang benar (`apps/frontend/vite.config.ts` membaca
`VITE_TASKS_RS_BASE_URL`).

Backend butuh `DATABASE_URL` dan `AUTH_JWT_SECRET`. Untuk data yang bisa dilihat,
pakai binary seed di `apps/backend-rs/crates/app/src/bin/` — baca dulu sebelum
membuat sendiri.

Buka sebuah project, masuk ke tab **All Tasks**.

- [ ] **Step 2: Lipat dan buka satu module**

Klik chevron di header sebuah module.

Expected: daftar task **dan** form quick-add hilang; nama module dan jumlah task
tetap terlihat; chevron berputar. Klik lagi → terbuka kembali.

- [ ] **Step 3: Keadaannya bertahan setelah reload**

Lipat dua module, lalu muat ulang halaman (F5).

Expected: kedua module itu **sudah terlipat saat halaman selesai dimuat**, tanpa
kedipan terbuka-lalu-menutup. Kedipan itu berarti `getOnInit: true` hilang.

- [ ] **Step 4: Terpisah per project**

Buka project lain, lalu kembali.

Expected: module di project kedua semuanya terbuka; lipatan di project pertama
tetap utuh.

- [ ] **Step 5: Menjatuhkan task ke module yang terlipat**

Lipat sebuah module. Seret sebuah task dari module lain dan jatuhkan di atas
header module yang terlipat itu.

Expected: task pindah ke module tersebut. Buka module itu untuk memastikan task-nya
benar-benar ada di sana, di urutan terakhir.

- [ ] **Step 6: Mengurutkan di dalam module yang terbuka tidak rusak**

Ini yang paling mungkin rusak oleh Step 3 di Task 2, dan paling mudah terlewat.

Di sebuah module yang **terbuka**, seret satu task ke posisi lain di dalam module
yang sama.

Expected: task pindah ke posisi itu, **bukan** melompat ke urutan terakhir.
Kalau ia melompat ke akhir, berarti `<section>` yang droppable memenangkan
deteksi tabrakan atas baris task, dan ref-nya perlu ditaruh di elemen yang tidak
menyelimuti daftar task — laporkan ini, jangan tambal dengan menebak.

Ulangi dengan menyeret task **antar** module yang keduanya terbuka.

- [ ] **Step 7: Keyboard dan screen reader**

Tab ke tombol chevron, tekan Enter atau Spasi.

Expected: module terlipat/terbuka. Periksa di DevTools bahwa tombolnya punya
`aria-expanded` yang berubah `true`/`false`, dan `aria-controls` yang menunjuk id
elemen badan module.

- [ ] **Step 8: Module yang dihapus tidak meninggalkan masalah**

Lipat sebuah module, lalu hapus module itu.

Expected: tidak ada error; module lain tidak ikut berubah keadaannya. Id basi
memang tertinggal di localStorage — itu diterima sadar di spec, bukan bug.

- [ ] **Step 9: Bersihkan dan commit perbaikan bila ada**

Hentikan kedua server dengan mencari pid-nya lalu `kill` pid itu. **Jangan**
memakai `pkill -f` dengan pola yang juga cocok dengan perintah yang sedang
diketik — ia mencocoki dirinya sendiri.

```bash
git commit -am "fix(tasks): address collapsible module verification findings"
```

Kalau tidak ada temuan, lewati commit ini — jangan membuat commit kosong.

Laporkan untuk tiap langkah: apa yang dilakukan, apa yang terjadi, lulus atau
tidak. Dan laporkan apa yang **tidak** bisa diverifikasi, kalau ada.
