# Tech Stack — contoh terisi

> **Contoh referensi**, bukan template yang harus kamu pakai. Ia memakai stack layanan web generik untuk menunjukkan *bentuk* pengisian yang baik: setiap pilihan punya alasan singkat, versi eksplisit, status, dan (untuk yang konsekuensial) jejak ADR. Salin struktur dari [`TECH_STACK.md`](TECH_STACK.md) lalu isi dengan stack proyekmu sendiri. Referensi `ADR-00xx` di bawah bersifat ilustratif.

## 1. Prinsip pemilihan

Sebelum sebuah teknologi masuk ke stack, ia harus lolos prinsip berikut — sejalan dengan invarian di [`ARCHITECTURE_BIBLE.md`](ARCHITECTURE_BIBLE.md):

1. **Vendor di pinggir.** Layanan/penyedia eksternal berada di balik adapter; model data inti tidak bergantung pada satu vendor.
2. **Dapat diganti.** Setiap pilihan punya jalan keluar (exit) yang masuk akal — format terbuka, standar, atau abstraksi yang tipis.
3. **Membosankan lebih dulu.** Teknologi matang dan dipahami tim mengalahkan yang baru dan menarik, kecuali ada nilai yang terbukti.
4. **Membuktikan nilainya.** Kompleksitas baru (bahasa, framework, layanan) harus membuktikan peningkatan nilai, bukan sekadar kemampuan teknis.

> Pada contoh ini: OpenTelemetry masih **Trial** karena belum terbukti sepadan dengan biaya operasionalnya — kompensasinya dicatat di §2.4.

## 2. Stack saat ini

Status memakai siklus di [§4](#4-siklus-status). Kolom **ADR** menautkan ke keputusan yang mengesahkan pilihan (kosongkan `—` bila belum diformalkan).

### 2.1 Bahasa & runtime

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Bahasa utama | TypeScript | 5.x | Tipe statis menjaga kontrak antar-modul; ekosistem luas dan dipahami tim. | ADR-0002 | Adopted |
| Runtime | Node.js LTS | 22.x | Hanya versi LTS agar jendela dukungan jelas; setara dengan target deploy. | — | Adopted |

### 2.2 Aplikasi & framework

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Framework API | Fastify | 5.x | Tipis dan cepat; skema route berbasis JSON Schema sejalan dengan disiplin kontrak repo. | ADR-0003 | Adopted |
| Frontend / UI | — | — | Layanan ini API-only; UI (bila ada) berada di repo terpisah. | — | Hold |

### 2.3 Penyimpanan data

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Basis data utama | PostgreSQL | 16 | Relasional matang, format dump terbuka (mendukung invarian portabilitas data). | ADR-0004 | Adopted |
| Cache / antrian | Redis | 7.x | Cache + antrian ringan di balik adapter; bisa ditukar tanpa menyentuh model inti. | — | Adopted |

### 2.4 Infrastruktur & operasi

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Hosting / runtime deploy | Kontainer OCI di platform terkelola | — | Image OCI standar → tidak terkunci ke satu penyedia; migrasi = pindah registry + orkestrator. | ADR-0005 | Adopted |
| CI/CD | GitHub Actions | — | Sudah di tempat kode berada; workflow deklaratif dapat ditinjau. | — | Adopted |
| Observability | OpenTelemetry | — | Standar terbuka lintas-vendor. **Kompensasi Trial:** overhead operasional belum terbukti sepadan pada skala saat ini. | — | Trial |

### 2.5 Perkakas pengembang

| Area | Pilihan | Versi | Alasan | ADR | Status |
| --- | --- | --- | --- | --- | --- |
| Manajer paket | pnpm | 9.x | Lockfile ketat + store konten-addressable → build reproducible. | — | Adopted |
| Lint / format | Biome | 1.x | Satu perkakas untuk lint + format; konfigurasi minimal. | — | Trial |
| Kerangka uji | Vitest | 2.x | Cepat, ESM-native, API selaras dengan ekosistem TypeScript. | — | Adopted |

## 3. Yang sengaja tidak dipakai

Menuliskan yang **ditolak** sama pentingnya dengan yang dipilih — ia mencegah perdebatan yang sama terulang.

| Teknologi | Mengapa ditolak (untuk saat ini) | Kapan ditinjau ulang |
| --- | --- | --- |
| ORM penuh (mis. Prisma) | Menyembunyikan biaya query dan menyulitkan penelusuran; kami memakai query builder tipis. | Saat skema melampaui ~40 tabel dan boilerplate jadi beban nyata. |
| Basis data NoSQL sebagai store utama | Data kami sangat relasional; konsistensi transaksional lebih penting daripada fleksibilitas skema. | Bila muncul domain dengan pola akses yang benar-benar non-relasional. |
| Monorepo build tool (mis. Nx/Turbo) | Satu layanan; overhead orkestrasi belum berbayar. | Saat repo tumbuh menjadi ≥3 paket yang saling bergantung. |

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

> Contoh aturan yang layak dipromosikan ke [`STANDARDS.md`](STANDARDS.md): "Runtime Node.js MUST = rilis LTS aktif" — bisa ditegakkan CI, bukan sekadar catatan di sini.

---

Dokumen ini adalah cermin praktis dari [`ARCHITECTURE_BIBLE.md`](ARCHITECTURE_BIBLE.md): invarian menetapkan *apa yang harus tetap benar*, tech stack menetapkan *dengan apa kita mewujudkannya sekarang*. Ketika keduanya berbenturan, invarian menang — dan stack yang harus berubah.
