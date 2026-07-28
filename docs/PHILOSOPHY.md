# Philosophy

> Prinsip untuk keputusan produk dan desain. Ketika dua opsi sama-sama masuk akal secara teknis, prinsip inilah yang memutuskan.

## Prinsip

### 1. Kejelasan status di atas segalanya

Ketika sebuah fitur harus memilih antara membuat status proyek lebih mudah dilihat atau menambah kemampuan lain, pilih kejelasan.

**Kapan berlaku:** setiap keputusan tampilan, ringkasan, dan default — dashboard, tabel tugas, indikator status, timeline.
**Konsekuensi:** keadaan pekerjaan harus terbaca tanpa membuka detail atau bertanya ke orang. Informasi yang menjawab "apa statusnya sekarang" mendapat tempat paling menonjol; yang jarang dibutuhkan disembunyikan, bukan sebaliknya.

### 2. Kecepatan input mengalahkan kelengkapan input

Menangkap pekerjaan harus nyaris tanpa friksi; melengkapi detailnya boleh menyusul.

**Kapan berlaku:** setiap alur pembuatan/perubahan — tambah tugas, ubah status, tulis komentar.
**Konsekuensi:** aksi umum harus punya jalur cepat (tambah tugas inline, ubah status langsung dari tabel, `Cmd/Ctrl+Enter` untuk submit). Field wajib ditekan seminimum mungkin (judul saja untuk tugas baru). Jika sebuah alur memaksa dialog penuh untuk hal yang sering dilakukan, desainnya salah.

### 3. Struktur melayani pekerjaan, bukan sebaliknya

Proses, hierarki, dan field hanya berhak ada bila membuat pekerjaan lebih jelas.

**Kapan berlaku:** menambah tahap status, field wajib, tingkat hierarki, atau alur yang menuntut proses.
**Konsekuensi:** jangan memaksakan satu metodologi. Tiap penambahan struktur harus membuktikan bahwa ia membuat status lebih jelas atau pekerjaan lebih cepat — bukan karena "praktik yang benar" menuntutnya. Kolom yang tak seorang pun baca adalah beban, bukan fitur.

### 4. Satu cara untuk satu hal

Konsistensi lintas fitur lebih berharga daripada solusi lokal yang lebih pintar.

**Kapan berlaku:** menambah fitur, hook data, komponen, atau gaya baru.
**Konsekuensi:** pakai pola yang sudah ada sebelum membuat yang baru — factory hook (`createMutationHook`, `normalizeQueryResult`), komponen bersama (`UserCombobox`, `PropertyRow`, `DatePickerField`), dan Tailwind untuk semua gaya baru. Menyimpang dari pola yang ada butuh alasan yang ditulis, bukan preferensi.

### 5. Provenance bukan tambahan

Riwayat "siapa mengubah apa, kapan" adalah bagian dari data, bukan fitur opsional.

**Kapan berlaku:** setiap perubahan yang memengaruhi kepemilikan, penugasan, status, atau isi.
**Konsekuensi:** perubahan penting mencatatkan jejaknya (activity log, timestamp, mention/notifikasi). Fitur yang mengubah data tanpa meninggalkan jejak dianggap belum selesai.

## Trade-off yang kami pilih secara sadar

| Kami utamakan | Di atas | Alasan |
| --- | --- | --- |
| Kejelasan status | Kekayaan fitur | Proyek yang sehat adalah yang statusnya bisa dilihat siapa saja tanpa bertanya. |
| Kesederhanaan | Keluwesan proses | Struktur yang berlebihan membebani setiap tim demi segelintir kasus. |
| Konsistensi pola | Keleluasaan per-fitur | Produk yang seragam bisa dipercaya, dikembangkan, dan di-*review* lebih cepat. |
| Kepemilikan & portabilitas data | Kenyamanan integrasi vendor | Pekerjaan tim tidak boleh tersandera satu penyedia. |
| Jalur cepat untuk aksi umum | Keseragaman satu-form-untuk-semua | Kecepatan input adalah alasan tim memilih alat ini ketimbang chat/spreadsheet. |

## Tanda keputusan yang buruk

- Menambah field, tahap, atau hierarki tanpa bisa menunjukkan status mana yang jadi lebih jelas.
- Status proyek hanya bisa dipahami dengan membuka banyak detail atau bertanya ke orang.
- Menambah cara kedua untuk hal yang sudah punya pola (hook, komponen, gaya) tanpa alasan tertulis.
- Alur yang sering dipakai memerlukan lebih banyak klik daripada mencatatnya di chat.
- Perubahan data yang tidak menyisakan jejak siapa/kapan.
- Model data inti mulai mengimpor tipe khusus satu vendor/layanan.
- Kompleksitas baru dibenarkan dengan "karena bisa" atau "karena alat lain punya", bukan dengan nilai yang terbukti.

---

Filosofi memandu penilaian sehari-hari. Ketika sebuah keputusan besar dan konsekuensial, ia harus melewati **Architecture decision test** di [ARCHITECTURE_BIBLE](ARCHITECTURE_BIBLE.md).
