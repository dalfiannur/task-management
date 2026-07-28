# Architecture Bible

> Sumber kebenaran konseptual untuk arsitektur `Project Management`. Ia menetapkan apa yang harus tetap benar ketika produk, teknologi, dan antarmuka berkembang. Dokumen ini berubah lambat dan dilindungi oleh proses RFC/ADR.

## 1. Purpose

`Project Management` adalah alat manajemen proyek untuk tim mana pun — sebuah SPA React di atas API berbasis ECS (bunsane) dengan kontrak GraphQL. Ia berdiri sebagai layanan mandiri; saat ini berjalan di dalam ekosistem Sedjiwa Portal, tetapi identitasnya adalah alat proyek serba-guna, bukan bagian tak-terpisahkan dari satu portal.

Arsitekturnya harus memungkinkan **anggota tim** untuk:

1. memecah proyek menjadi modul dan tugas, membaginya, dan melacak statusnya;
2. memahami sejarah setiap tugas — siapa mengubah apa dan kapan — dari dalam sistem;
3. menyimpan tugas, jadwal, catatan, dan file sebuah proyek sebagai satu kesatuan yang bisa diekspor.

## 2. Architectural invariants

Prinsip berikut **tidak boleh dikorbankan** demi kemudahan implementasi jangka pendek. Setiap baris memasangkan invarian dengan konsekuensi arsitekturalnya yang dapat diperiksa.

| Invarian | Konsekuensi arsitektural |
| --- | --- |
| **Data milik pengguna** | Objek inti disimpan relasional (PostgreSQL) dan dapat diekspor ke format terbuka yang tetap bermakna di luar aplikasi. |
| **Dapat ditelusuri (provenance)** | Perubahan penting pada tugas menyimpan pelaku, waktu, dan jenis perubahan (activity log); objek inti membawa timestamp. |
| **Modular secara default** | Kemampuan hadir sebagai komponen/arketipe/service berkontrak (ECS bunsane), bukan perubahan tersembunyi pada inti. |
| **Vendor & layanan di pinggir** | Layanan eksternal (Core/Media/Sales portal, penyimpanan S3, penyedia auth) berada di balik adapter/klien; model data inti tidak bergantung pada satu penyedia. |
| **Identitas mandiri** | Autentikasi dan otorisasi diselesaikan lokal (JWT HS256 + izin internal); layanan tidak bergantung pada ketersediaan OIDC eksternal untuk berfungsi. |
| **Kontrak eksplisit & berversi** | Skema GraphQL diturunkan dari arketipe/skema Zod; kontrak data yang dipublikasikan diberi versi dan dimigrasikan secara eksplisit. |

> Isi tabel ini adalah keputusan terpenting dalam repo. Ubah hanya lewat RFC + ADR.

## 3. Canonical system model

Urutan ketergantungan **makna** (bukan diagram panggilan runtime): setiap lapisan di bawah melayani maksud lapisan di atasnya.

```text
Maksud pengguna (SPA: halaman, dialog, aksi cepat)
        ↓
Kemampuan domain (proyek, modul, tugas, pages, media, notifikasi)
        ↓
Kontrak (operasi GraphQL berbasis `input`, arketipe, skema Zod)
        ↓
Eksekusi (services + komponen ECS/bunsane)
        ↓
Infrastruktur bersama (PostgreSQL, penyimpanan S3, layanan portal tetangga)
        ↓
Artefak (data terekspor, file terunggah, JWT)
```

### 3.1 Maksud pengguna
SPA (React + React Router). Menangkap niat lewat halaman dan dialog, memberi jalur cepat untuk aksi umum, dan menggerakkan seluruh state server melalui hook Apollo. Tidak menyimpan logika domain yang otoritatif.

### 3.2 Kemampuan domain
Konsep yang dipahami pengguna: proyek dan statusnya, modul, tugas beserta atribut (status/prioritas/assignee/label/tanggal), komentar & mention, activity log, timeline, pages, media. Setiap kemampuan berdiri sebagai unit berkontrak.

### 3.3 Kontrak
Batas antara klien dan server: operasi GraphQL yang setiap argumennya dibungkus satu objek `input` wajib, output berbentuk arketipe, input divalidasi skema Zod. Kontrak adalah permukaan yang stabil; internal boleh berubah di baliknya.

### 3.4 Eksekusi
Logika bisnis di `services/`, data di `components/` (ECS), bentuk entitas di `archetypes/`. Middleware (plugins, mis. AuthPlugin) menyediakan konteks lintas-potong seperti pengguna terverifikasi.

### 3.5 Infrastruktur bersama
PostgreSQL sebagai store utama; penyimpanan S3-compatible untuk file; layanan portal tetangga (Core/Media/Sales) diakses lewat klien terpisah. Semuanya dapat ditukar di balik adapter.

### 3.6 Artefak
Keluaran yang hidup di luar runtime: data yang diekspor, file yang diunggah, token yang diterbitkan. Semua harus tetap bermakna/terverifikasi di luar satu sesi aplikasi.

## 4. Data and provenance

Setiap objek inti memiliki, sejauh relevan:

| Elemen | Tujuan |
| --- | --- |
| Stable ID | Referensi yang tak berubah ketika nama atau lokasi berubah (identitas entitas ECS). |
| Ownership & scope | Menentukan proyek/pemilik dan batas akses (keanggotaan proyek, tag admin/izin). |
| Timestamps & version | Menjelaskan kapan dibuat/diubah dan versi kontrak yang dipakai. |
| Relations | Hubungan eksplisit: tugas→modul→proyek, tugas→assignee/label. Sumber eksternal (mis. *lead* dari portal) boleh tertaut sebagai relasi opsional, bukan syarat sebuah proyek. |
| Provenance | Bagaimana kondisi tugas tercapai: activity log, komentar, mention, notifikasi. |
| Portability | Bentuk ekspor terbuka yang terbaca di luar sistem (dump relasional / format terbuka). |

## 5. Product boundaries

`Project Management` **bukan**:

- **CRM / mesin penjualan.** Ia mengelola pekerjaan, bukan pipeline penjualan. Sumber pekerjaan dari luar (mis. *lead* dari portal) boleh masuk sebagai integrasi opsional, tetapi tidak menjadikan sistem ini pemilik data penjualan.
- **Penyedia identitas untuk seluruh ekosistem.** Ia mengelola pengguna dan auth-nya sendiri, tetapi tidak berperan sebagai OIDC provider bersama.
- **Penyimpanan file / DAM umum.** File berkaitan dengan proyek/tugas; penyimpanan objek adalah infrastruktur di baliknya, bukan produk inti.
- **Alat yang memaksakan satu metodologi.** Ia menyediakan struktur (proyek, modul, status) tanpa mengunci tim pada satu cara kerja tertentu.

Sistem boleh terhubung dengan hal-hal tersebut bila berguna, tetapi tidak mengadopsinya sebagai sifat inti.

## 6. Evolution rules

1. Kontrak dan format ekspor diberi versi serta dimigrasikan secara eksplisit.
2. Ketergantungan vendor/layanan berada di pinggir sistem, bukan di model data inti.
3. Fitur baru memulai sebagai komponen/service ECS terisolasi sebelum menjadi inti.
4. Setiap otomatisasi memiliki mode observasi/pratinjau sebelum aksi yang sulit dibalik.
5. Keputusan yang memengaruhi kepemilikan data, izin, dan provenance memerlukan tinjauan lebih tinggi (RFC + ADR).
6. Kompleksitas baru harus membuktikan peningkatan nilai, bukan sekadar kemampuan teknis.

## 7. Architecture decision test

Sebelum sebuah keputusan arsitektural diterima, jawab:

1. Apakah pengguna tetap dapat memiliki, memahami, dan memindahkan hasil kerjanya?
2. Apakah kemampuan ini dapat diganti, dikembangkan, atau dinonaktifkan tanpa merusak inti?
3. Apakah konteks dan asal-usul perubahannya cukup jelas untuk dipercaya dan ditinjau?
4. Apakah akses data dan tindakan otomatisnya dibatasi secara eksplisit (auth/izin)?
5. Apakah desain ini masih berguna jika satu layanan/model eksternal (Core/Media/Sales/auth) sedang tak tersedia?

Jika jawabannya tidak jelas, keputusan belum siap.

---

Dokumen ini akan melahirkan keputusan teknis, skema data, dan kontrak API. Perubahan tersebut harus **memperkuat** invarian di atas — bukan mengubahnya secara diam-diam. Perubahan invarian memerlukan RFC + ADR.
