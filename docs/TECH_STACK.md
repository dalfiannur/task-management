# Tech Stack

> Daftar **pilihan teknologi** `Sedjiwa Task Management` beserta **alasan** dan **jejak keputusannya**. Ini bukan sekadar inventaris — setiap pilihan konsekuensial harus bisa ditelusuri ke sebuah ADR. Dokumen ini berubah lambat; perubahan pada teknologi inti melewati RFC → ADR (ARCHITECTURE_BIBLE §6).
>
> Butuh acuan pengisian? Lihat [`TECH_STACK.example.md`](TECH_STACK.example.md) — versi terisi penuh dengan stack layanan generik.

## 1. Prinsip pemilihan

Sebelum sebuah teknologi masuk ke stack, ia harus lolos prinsip berikut — sejalan dengan invarian di [`ARCHITECTURE_BIBLE.md`](ARCHITECTURE_BIBLE.md):

1. **Vendor di pinggir.** Layanan/penyedia eksternal berada di balik adapter; model data inti tidak bergantung pada satu vendor.
2. **Dapat diganti.** Setiap pilihan punya jalan keluar (exit) yang masuk akal — format terbuka, standar, atau abstraksi yang tipis.
3. **Membosankan lebih dulu.** Teknologi matang dan dipahami tim mengalahkan yang baru dan menarik, kecuali ada nilai yang terbukti.
4. **Membuktikan nilainya.** Kompleksitas baru (bahasa, framework, layanan) harus membuktikan peningkatan nilai, bukan sekadar kemampuan teknis.

> Catatan: `bunsane` (framework ECS in-house) adalah kompleksitas berbiaya tinggi yang belum matang secara ekosistem — kompensasinya dicatat di §2.2 dan sebaiknya diformalkan lewat ADR.

## 2. Stack saat ini

Status memakai siklus di [§4](#4-siklus-status). Kolom **ADR** menautkan ke keputusan yang mengesahkan pilihan (kosongkan `—` bila belum diformalkan). Versi mengikuti `package.json` per repo — perbarui saat naik versi mayor.

### 2.1 Bahasa & runtime

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Bahasa utama | TypeScript | 5.5.x | Tipe statis menjaga kontrak antar-modul (frontend & backend seragam). | — | Adopted |
| Runtime backend | Bun | 1.x | Runtime + bundler + test runner dalam satu; dukungan dekorator + TS langsung. | — | Adopted |

### 2.2 Aplikasi & framework

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Framework API | bunsane (ECS in-house) | 0.2.x | ECS + auto-generate skema GraphQL dari arketipe/Zod. **Kompensasi:** in-house & pra-1.0 → risiko *bus factor*; abstraksi harus dijaga tipis dan berkontrak. | — | Adopted |
| Lapisan GraphQL | graphql | 16.11 | Standar kontrak klien-server; di-*pin* agar konsisten lintas paket (`overrides`). | — | Adopted |
| Frontend / UI | React + React Router | 19.x / 7.x | Ekosistem matang; routing berbasis file yang dipahami tim. | — | Adopted |
| Klien data | Apollo Client | 4.x | Cache + hook GraphQL; satu klien per layanan (core/media/sales) sebagai adapter. | — | Adopted |
| State UI | Zustand | 5.x | State lokal (auth, UI) ringan dengan `persist`; tanpa boilerplate. | — | Adopted |
| Styling | Tailwind CSS + shadcn/ui (Radix) | 4.x | Satu sistem gaya; primitif aksesibel. Menggantikan CSS Modules (lihat STD-0003). | — | Adopted |
| Editor rich-text | Tiptap | 3.x | Editor modular untuk deskripsi tugas & pages. | — | Adopted |
| Build frontend | Vite | 5.x | Dev server cepat + build produksi standar. | — | Adopted |

### 2.3 Penyimpanan data

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Basis data utama | PostgreSQL | 15+/16 | Relasional matang, dump terbuka (mendukung invarian portabilitas data). | — | Adopted |
| Penyimpanan objek | S3-compatible (RustFS) | — | API S3 standar → tidak terkunci penyedia; di balik `@aws-sdk/client-s3`. | — | Adopted |

### 2.4 Autentikasi

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Auth | JWT lokal (HS256, phone+password) | — | Identitas mandiri; tak bergantung ketersediaan OIDC eksternal (lihat STD-0004). | — | Adopted |
| Pustaka JWT | jose | 6.x | Verifikasi/penandatanganan JWT standar. | — | Adopted |
| OIDC eksternal | — | — | Sebelumnya dipakai; kini **dihapus** demi identitas mandiri. | — | Deprecated |

### 2.5 Perkakas pengembang

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Manajer paket / runner | Bun | 1.x | Satu perkakas untuk install + run + test. | — | Adopted |
| Lint | ESLint | 8.57 | Standar lint TS/TSX; dipakai frontend & backend. | — | Adopted |
| Validasi skema | Zod | 4.x | Sumber tunggal untuk input GraphQL + validasi runtime. | — | Adopted |
| Kerangka uji | `bun test` | (Bun) | Unit test untuk auth/user pure di backend. **Catatan:** frontend belum punya framework tes. | — | Trial |

> Frontend belum memiliki kerangka uji — ini utang teknis yang sebaiknya diangkat sebagai RN/RFC bila cakupan uji UI menjadi kebutuhan.

## 3. Yang sengaja tidak dipakai

Menuliskan yang **ditolak** sama pentingnya dengan yang dipilih — ia mencegah perdebatan yang sama terulang.

| Teknologi | Mengapa ditolak (untuk saat ini) | Kapan ditinjau ulang |
| --- | --- | --- |
| OIDC / penyedia identitas eksternal | Menambah ketergantungan runtime pada layanan lain; identitas mandiri lebih sederhana untuk skala saat ini. | Bila SSO lintas seluruh portal menjadi kebutuhan tegas. |
| ORM penuh (mis. Prisma) | Menyembunyikan biaya query & menyulitkan penelusuran; model ECS bunsane sudah menangani persistensi. | Bila pola akses data melampaui yang nyaman ditangani ECS. |
| CSS Modules untuk kode baru | Dua sistem gaya paralel menimbulkan drift; Tailwind dijadikan default. | Tidak — yang ada dimigrasikan saat disentuh (STD-0003). |

## 4. Siklus status

Setiap pilihan menyandang satu status. Terinspirasi "ring" tech radar — sinyal komitmen, bukan sekadar suka/tidak suka.

| Status | Arti |
| --- | --- |
| **Adopted** | Pilihan default. Pakai ini untuk pekerjaan baru kecuali ada alasan terdokumentasi. |
| **Trial** | Dipakai pada cakupan terbatas untuk membuktikan nilai. Belum default. |
| **Hold** | Jangan adopsi baru. Yang sudah ada boleh tinggal sampai ada rencana migrasi. |
| **Deprecated** | Sedang dipensiunkan. Setiap pemakaian baru butuh justifikasi eksplisit + ADR. |

## 5. Menambah/mengubah stack

Perubahan konsekuensial (bahasa, basis data, framework inti, penyedia yang sulit diganti) mengikuti operating model repo:

1. **RFC** — usulkan pilihan beserta alternatif yang dipertimbangkan dan biaya migrasinya.
2. **ADR** — bila diterima, catat keputusan + konsekuensinya, lalu tautkan dari tabel di [§2](#2-stack-saat-ini).
3. **Perbarui dokumen ini** — set/ubah **Status** dan isi kolom **ADR**.

Perubahan kecil dan mudah dibalik (mis. menaikkan versi minor sebuah perkakas dev) tidak butuh RFC — cukup perbarui tabel.

> Aturan verifikasi versi yang ingin ditegakkan mesin sebaiknya juga ditulis sebagai standar di [`STANDARDS.md`](STANDARDS.md), bukan hanya sebagai catatan di sini.

---

Dokumen ini adalah cermin praktis dari [`ARCHITECTURE_BIBLE.md`](ARCHITECTURE_BIBLE.md): invarian menetapkan *apa yang harus tetap benar*, tech stack menetapkan *dengan apa kita mewujudkannya sekarang*. Ketika keduanya berbenturan, invarian menang — dan stack yang harus berubah.
