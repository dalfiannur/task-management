# Standards

> Aturan lintas-potong yang **dapat diuji**. Berbeda dari Philosophy (penilaian) — Standards adalah aturan yang idealnya bisa diperiksa mesin: schema, linter, atau tes.

Setiap standar punya **ID**, pernyataan **normatif** (gunakan MUST / SHOULD / MAY), dan cara **verifikasi**.

## Format

```text
STD-<NNNN>: <judul singkat>
  Rule:   <pernyataan normatif — MUST/SHOULD/MAY>
  Why:    <alasan; kaitkan ke invarian ARCHITECTURE_BIBLE bila ada>
  Verify: <bagaimana memeriksanya — schema/tes/lint/review>
```

## Katalog

### STD-0001: Argumen GraphQL dibungkus objek `input`

- **Rule:** Setiap operasi GraphQL **MUST** membungkus argumennya dalam satu objek `input` wajib bernama `<opName>Input` (mis. `login(input: loginInput!)`).
- **Why:** Kontrak yang seragam dan dapat dikembangkan tanpa memecah tanda tangan operasi (ARCHITECTURE_BIBLE §3.3 — kontrak eksplisit).
- **Verify:** Review skema/operasi; introspeksi GraphQL — tak ada operasi dengan argumen posisional selain `input`.

### STD-0002: Hook data lewat factory & normalisasi

- **Rule:** Hook mutasi **MUST** dibangun dengan `createMutationHook`/`createVoidMutationHook`; hook query **MUST** mengembalikan hasil melalui `normalizeQueryResult`. Semua hook **MUST** mengekspos `isLoading` (bukan `isPending`).
- **Why:** Satu cara untuk satu hal (PHILOSOPHY §2); bentuk return yang konsisten lintas fitur.
- **Verify:** Lint/review di `apps/frontend/src/hooks/`; grep tak menemukan `useMutation`/`useQuery` mentah yang mem-bypass factory tanpa alasan tertulis.

### STD-0003: Gaya baru memakai Tailwind

- **Rule:** Kode baru (halaman, komponen, layout) **MUST** memakai kelas utilitas Tailwind dan helper `cn()`; berkas CSS Module baru **MUST NOT** dibuat.
- **Why:** Satu sistem gaya; mengurangi drift visual dan biaya pemeliharaan.
- **Verify:** Review; CI/grep menandai `*.module.css` yang baru ditambahkan.

### STD-0004: Auth berbasis JWT lokal

- **Rule:** API **MUST** memverifikasi JWT lokal (HS256, `AUTH_JWT_SECRET`) untuk permintaan terautentikasi; **MUST NOT** bergantung pada OIDC/JWKS eksternal untuk berfungsi. `AUTH_JWT_SECRET` **MUST** wajib ada saat start.
- **Why:** Invarian identitas mandiri (ARCHITECTURE_BIBLE §2).
- **Verify:** Unit test di `apps/backend/src/auth/*.test.ts`; boot gagal cepat bila `AUTH_JWT_SECRET` tak diset.

### STD-0005: Layanan eksternal di balik klien terpisah

- **Rule:** Akses ke layanan tetangga (Core/Media/Sales) **MUST** melalui klien Apollo/adapter khusus (`coreClient`, `mediaClient`, `salesClient`), bukan meng-hardcode tipe/URL vendor ke dalam model data inti.
- **Why:** Invarian vendor/layanan di pinggir (ARCHITECTURE_BIBLE §2).
- **Verify:** Review `src/lib/graphql-client.ts` + call sites; grep tak menemukan URL layanan eksternal yang tersebar di luar konfigurasi klien.

### STD-0006: Perubahan konsekuensial lewat RFC → ADR

- **Rule:** Perubahan pada invarian arsitektur, kontrak publik, atau teknologi inti (bahasa, DB, framework) **MUST** melewati RFC lalu direkam sebagai ADR sebelum diimplementasikan.
- **Why:** Tata-kelola documentation-first ([ADR-0001](ADR/ADR-0001-documentation-first.md)).
- **Verify:** Review PR — perubahan konsekuensial menautkan RFC/ADR; nomor bersifat berurutan & append-only.

### STD-0007: Kontrak data yang dipublikasikan berversi

- **Rule:** Setiap kontrak data yang dipublikasikan (schema di `docs/schema/`, format ekspor) **MUST** menyertakan field versi (`schema_version` atau setara).
- **Why:** Mendukung migrasi eksplisit (ARCHITECTURE_BIBLE §6.1).
- **Verify:** Schema JSON menandai field versi sebagai `required`; validator menolak dokumen tanpanya (lihat [conformance suite](validators/conformance/)).

> Prioritaskan aturan yang benar-benar bisa diverifikasi otomatis — aturan yang hanya bisa dinilai manusia sebaiknya tinggal di [Philosophy](PHILOSOPHY.md).

## Menuju conformance yang machine-checkable

Saat proyek matang, promosikan standar menjadi artefak yang dapat dieksekusi:

1. **Schema** ([`schema/v1/*.json`](schema/v1/)) untuk struktur data.
2. **Katalog aturan** — daftar STD dalam bentuk data, divalidasi oleh schema.
3. **Fixture + validator** yang menjalankan schema terhadap contoh valid dan tak-valid.

Dengan begitu, spesifikasi tidak bisa diam-diam menyimpang dari implementasi.

### Contoh yang sudah tersedia

Template ini menyertakan satu kontrak lengkap sebagai teladan — katalog aturan ini sendiri dalam bentuk data:

| Artefak | Berkas |
| --- | --- |
| Schema katalog aturan v1 | [`schema/v1/conformance-rule-catalog.schema.json`](schema/v1/conformance-rule-catalog.schema.json) |
| Contoh valid & tak-valid | [`schema/examples/`](schema/examples/) |
| Kontrak validator (language-neutral) | [`spec/VALIDATOR_CONTRACT.md`](spec/VALIDATOR_CONTRACT.md) |
| Implementasi + conformance suite | [`validators/`](validators/) |

Jalankan `python3 validators/python/validate.py schema/v1/conformance-rule-catalog.schema.json schema/examples/*.json` dari dalam `docs/` untuk melihatnya bekerja. Validator didefinisikan sebagai **kontrak**, jadi bahasa implementasinya bebas diganti selama lolos [conformance suite](validators/conformance/). Tiru pola ini untuk setiap kontrak baru.
