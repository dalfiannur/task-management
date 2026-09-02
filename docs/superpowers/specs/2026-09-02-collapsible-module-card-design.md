# Module Card yang Bisa Dilipat — Design

**Date:** 2026-09-02
**Status:** Approved (design)
**Scope:** Frontend saja — `apps/frontend/src/features/tasks`

## Ringkasan

`ModuleSection` di tab All Tasks bisa dilipat per module. Header tetap terlihat;
daftar task dan form quick-add tersembunyi. Keadaan terlipat diingat per browser,
per project.

Project dengan banyak module memaksa scrolling panjang untuk mencapai satu module
yang sedang dikerjakan. Melipat sisanya menyelesaikan itu tanpa mengubah data apa
pun — ini murni preferensi tampilan.

## Keputusan

### 1. Pakai primitif `Collapsible` yang sudah ada

`apps/frontend/src/components/ui/collapsible.tsx` sudah ter-vendor tetapi belum
dipakai di mana pun. Memakainya memberi wiring `aria-expanded`/`aria-controls`
dan atribut `data-state` tanpa ditulis tangan, dan konten yang terlipat di-unmount
sehingga module dengan puluhan task tidak ikut dirender.

**Alternatif yang ditolak:**
- *Render kondisional dengan `useState`* — sekitar lima baris lebih sedikit, tapi
  aksesibilitasnya harus ditulis sendiri, dan di codebase yang seluruhnya shadcn
  ini justru penyimpangan.
- *Sembunyikan lewat CSS* — DOM tetap ter-mount sehingga target drop hidup dengan
  sendirinya, tapi biaya render tetap dibayar dan target drop tak terlihat adalah
  masalah yang justru ingin dihindari.

### 2. Keadaan terlipat diingat per browser, bukan per user di server

Disimpan di localStorage. Menyimpannya di backend berarti melipat sebuah module
ikut melipatnya untuk seluruh tim — perilaku yang hampir tidak pernah diinginkan
untuk preferensi tampilan, dan butuh field proto serta RPC baru.

### 3. Yang disimpan adalah daftar module yang **terlipat**

Bukan daftar yang terbuka. Konsekuensinya default-nya terbuka, sehingga module
yang baru dibuat langsung terlihat alih-alih lahir tersembunyi.

### 4. Per module saja, tanpa kendali massal

Tidak ada "lipat semua" dan tidak ada perilaku akordion. Kalau ternyata melipat
semuanya sekaligus sering dibutuhkan, itu keluhan yang mudah dijawab kemudian;
tombol yang tidak terpakai jauh lebih sulit dihapus setelah ada.

## Perubahan

### Komponen

`ModuleSection` (`features/tasks/components/module-section.tsx`) membungkus badan
module — daftar task **dan** form quick-add — di dalam `Collapsible`.

- **Header tetap terlihat** saat terlipat: nama, jumlah task, dan tombol kelola.
- **Jumlah task tetap tampil**; itu satu-satunya sinyal isi module saat badannya
  tersembunyi, dan sudah ada di header hari ini.
- **Form quick-add ikut terlipat.** Ia bagian dari isi module; menyisakannya akan
  membuat module "terlipat" yang masih menerima input terasa setengah jalan.
- **Chevron sebagai trigger, di paling kiri sebelum nama** — bukan di gerombolan
  tombol kelola di kanan. Melipat bukan tindakan mengelola dan tersedia untuk
  semua orang, bukan hanya yang punya `canManage`.
- **Chevron-nya harus dibedakan dari dua chevron yang sudah ada di header itu.**
  `ChevronUp`/`ChevronDown` di kanan sudah dipakai untuk mengurutkan module, jadi
  trigger lipat memakai `ChevronRight` yang berputar 90° saat terbuka
  (`transition-transform` digerakkan oleh `data-state`), bukan chevron atas/bawah
  lain yang akan terbaca sebagai kendali urutan ketiga.
- **Keadaan `Collapsible` dikendalikan atom**, bukan state internal Radix —
  `open` dan `onOpenChange` dijahit ke atom, supaya satu-satunya sumber kebenaran
  adalah nilai yang tersimpan.

### Persistensi

Atom baru di `features/tasks/atoms/collapsed-modules.ts`:

```ts
atomWithStorage<Record<string, string[]>>("sedjiwa.modules.collapsed", {})
```

Kunci `sedjiwa.modules.collapsed` mengikuti pola `sedjiwa.auth` yang sudah ada di
`features/auth/atoms/session.ts`. Bentuknya `projectId → id module yang terlipat`.

Id module yang sudah dihapus akan tertinggal di localStorage. Ini diterima sadar:
id basi tidak cocok dengan apa pun sehingga tidak berefek, dan menambahkan
penyapuan berarti menambah kode untuk masalah seberat beberapa byte.

### Drag & drop

`setNodeRef` pindah dari div isi ke elemen `<section>`. Satu baris, dan efeknya
module tetap jadi target drop dalam kedua keadaan:

- **Terbuka:** perilaku tidak berubah. Menjatuhkan di atas sebuah task tetap
  menyasar task itu, karena dnd-kit memilih droppable paling spesifik.
- **Terlipat:** menjatuhkan di header memindahkan task ke urutan terakhir module
  itu — persis seperti menjatuhkan di area kosong module hari ini.

Tanpa perubahan ini, melipat sebuah module akan diam-diam menghapusnya sebagai
tujuan drag, dan satu-satunya cara memindahkan task ke sana adalah membukanya
lebih dulu.

## Verifikasi

Frontend tidak punya framework test, jadi gerbang otomatisnya hanya
`bun run tsc --noEmit`, `bun run lint`, dan `bun run build`.

Itu membuktikan sangat sedikit di sini. Pekerjaan MCP yang baru selesai menemukan
dua bug nyata di halaman token yang lolos dari ketiga gerbang itu **dan** dari tiga
kali code review, karena keduanya bug siklus-hidup React yang hanya muncul saat
dijalankan. Rencana implementasi karena itu wajib memuat langkah verifikasi manual
di browser untuk tiga hal yang tidak akan ditangkap type-check:

1. Keadaan terlipat bertahan setelah reload halaman, dan terpisah per project.
2. Menjatuhkan task ke header module yang terlipat benar-benar memindahkannya ke
   module itu.
3. Chevron mengumumkan keadaan terbuka/terlipat dengan benar ke screen reader
   (`aria-expanded` berubah, `aria-controls` menunjuk badan yang benar).

## Di Luar Cakupan

- "Lipat semua" / "buka semua" dan perilaku akordion.
- Menyimpan keadaan terlipat di server atau membaginya antar perangkat.
- Melipat di tempat lain yang menampilkan module (Timeline, Overview).
- Animasi selain yang datang gratis dari `data-state` milik Radix.
