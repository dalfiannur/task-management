# CI: Build, Test, dan Publish Image ke GHCR — Design

**Date:** 2026-09-03
**Status:** Approved (design)
**Scope:** Satu workflow GitHub Actions. Tidak ada perubahan kode aplikasi.

## Ringkasan

Setiap push ke `main` menguji repo lalu mem-build dan mem-push image backend dan
frontend ke GHCR, ditandai dengan SHA commit. Pull request menjalankan test yang
sama tanpa mem-publish.

## Masalah yang diselesaikan

Repo ini tidak punya CI. Image GHCR hanya terbit kalau seseorang ingat
menjalankan `deploy/build.sh --push` dari mesinnya sendiri.

Akibatnya terlihat saat deploy 3 September 2026: `backend:latest` di produksi
tertanggal **21 Agustus** sementara `frontend:latest` tertanggal **1 September**.
Keduanya menyimpang diam-diam, dan backend produksi tertinggal 33 commit —
seluruh fitur MCP — tanpa ada yang menyadarinya. Tidak ada yang rusak; hanya
tidak ada yang memberitahu siapa pun.

## Keputusan

### 1. `arke` disematkan ke SHA, bukan branch

`apps/backend-rs/Cargo.toml` bergantung pada `arke` lewat **path** ke checkout
sibling (`../../../rust-ecs`), yang di GitHub adalah repo terpisah
`dalfiannur/arke` (publik). Dependensi path tidak dikunci `Cargo.lock`, jadi
tidak ada apa pun di repo ini yang mencatat versi arke mana yang dipakai sebuah
build.

Checkout lokal yang menghasilkan build produksi saat ini ada di branch
`feat/arke-mongo` — **31 commit di depan `main`** milik arke. Membangun dari
`main` akan menghasilkan backend yang berbeda secara material.

Workflow menyematkan SHA `bebc0bf` sebagai konstanta. Konsekuensinya disengaja:
menaikkan versi arke menjadi commit yang terlihat dan bisa di-review, bukan
pergeseran diam-diam. Ini juga membuat build reproducible — commit
task-management yang sama plus SHA arke yang sama selalu menghasilkan biner yang
sama.

**Alternatif yang ditolak:** mengikuti ujung `feat/arke-mongo` (branch bergerak
di bawah kita — penyakit yang sama dengan tag `latest` yang baru ditinggalkan,
satu lapis lebih dalam), dan mengikuti `main` (menghasilkan backend berbeda dari
yang berjalan di produksi hari ini).

### 2. Test menggerbangi publish

`test-backend` dan `test-frontend` berjalan paralel; `publish` membutuhkan
keduanya hijau. Tidak ada image terbit dari commit yang test-nya merah.

Backend dan frontend di-deploy sebagai pasangan dengan satu tag, jadi keduanya
diterbitkan dari satu job. Pipeline terpisah penuh akan lebih cepat tapi bisa
meninggalkan SHA yang setengah terbit saat satu sisi gagal.

### 3. Test backend butuh langkah pemanasan

`crates/persistence` menyinkronkan skema saat `Store::connect`. Ketika beberapa
binary test menyentuh database baru bersamaan, mereka berebut membuat tabel
komponen yang sama dan gagal dengan
`duplicate key value violates unique constraint "pg_type_typname_nsp_index"`.
Ini sudah tercatat sebagai perilaku yang diketahui: **run pertama terhadap
database yang benar-benar baru gagal sekali, lalu lolos.**

CI selalu mendapat database baru, jadi langkah "jalankan test" yang naif akan
gagal di setiap run.

Solusinya: jalankan **satu** test lebih dulu, sendirian. Koneksi pertamanya
menyinkronkan seluruh skema, setelah itu suite penuh berjalan paralel tanpa
balapan.

**Alternatif yang ditolak:** `--test-threads=1`. Ia menghilangkan balapan tapi
menyerialkan 164 test, dan CI yang lambat adalah CI yang orang mulai lewati.

### 4. Memakai ulang `deploy/build.sh`, bukan menulis ulang di YAML

Script itu sudah menangani hal-hal yang tidak sepele: menyusun build context
backend dari dua checkout supaya path relatif di manifest resolve, menandai
dengan SHA, dan menambahkan akhiran `-dirty` bila working tree kotor. Ia juga
terbukti dipakai untuk build produksi 3 September.

Menyalin logikanya ke YAML berarti dua tempat yang akan menyimpang. Workflow
memanggilnya dengan `ENGINE=docker` (default-nya podman) dan `ARKE_DIR` menunjuk
checkout arke.

### 5. Publish saja — CI tidak menyentuh produksi

CI berhenti setelah image terdorong ke GHCR. Deploy tetap keputusan sadar: set
`PM_IMAGE_TAG` di server lalu pull.

Ini menutup celah yang sebenarnya — image yang tidak pernah terbangun — tanpa
memberi CI kunci SSH produksi, dan tanpa membuat setiap merge ke `main` langsung
menyentuh produksi termasuk merge yang test-nya lulus tapi belum pernah dilihat
manusia di browser.

### 6. Build selalu jalan, tanpa penyaringan path

Repo ini banyak commit dokumentasi, dan menyaring per path akan menghemat menit
CI. Tapi harganya adalah SHA yang tidak punya image — dan itu menggigit tepat
saat seseorang ingin rollback ke commit tertentu. Cache cargo menahan biayanya.

## Bentuk workflow

Satu file: `.github/workflows/publish-images.yml`.

**Pemicu:** `push` ke `main`, dan `pull_request` yang menyasar `main`.

**Permission:** `contents: read`, `packages: write`. GHCR menerima `GITHUB_TOKEN`
bawaan untuk owner yang sama, jadi **tidak ada secret yang perlu disiapkan**.
`dalfiannur/arke` publik, sehingga `actions/checkout` mengambilnya tanpa token.

**Job `test-backend`**
- Service container `postgres:17-alpine`.
- Checkout task-management, lalu checkout `dalfiannur/arke` pada SHA tersemat ke
  path sibling yang membuat `../../../rust-ecs` resolve.
- Cache cargo registry dan `target/`.
- Jalankan satu test sebagai pemanasan, lalu `cargo test --workspace`.
- Env: `DATABASE_URL` menunjuk service container, `AUTH_JWT_SECRET` nilai apa pun.

**Job `test-frontend`**
- `bun install`, lalu `bun run tsc --noEmit`, `bun run lint`, `bun run build`.

**Job `publish`**
- `needs: [test-backend, test-frontend]`, dan `if:` hanya untuk push ke `main`.
- Checkout keduanya seperti di atas.
- Login ke `ghcr.io` dengan `GITHUB_TOKEN`.
- `ENGINE=docker ARKE_DIR=<path> deploy/build.sh --push`.

## Verifikasi

Workflow tidak bisa diuji tanpa dijalankan. Rencana implementasi harus:

1. Memvalidasi sintaksnya sebelum push (`actionlint` bila tersedia, atau baca
   ulang terhadap dokumentasi schema).
2. Menjalankannya sungguhan lewat sebuah pull request, bukan langsung push ke
   `main` — PR menjalankan kedua job test tanpa mem-publish, sehingga sintaks,
   service Postgres, langkah pemanasan, dan cache semuanya terbukti sebelum ada
   image yang terdorong.
3. Baru setelah PR hijau, merge — dan pastikan job `publish` menghasilkan image
   bertag SHA commit itu di GHCR.
4. Memastikan digest image dari CI cocok dengan hasil build lokal untuk commit
   yang sama, membuktikan reproducibility yang dijanjikan penyematan SHA arke.

## Di Luar Cakupan

- Deploy otomatis ke produksi, dan workflow `workflow_dispatch` untuk deploy.
- Memindahkan `arke` dari dependensi path ke dependensi git dengan `rev`, yang
  akan membuat `Cargo.lock` mengunci versinya dan menghapus kebutuhan
  penyematan di workflow. Perubahan itu menyentuh manifest dan cara build lokal
  bekerja; ia layak dipertimbangkan tersendiri.
- Build multi-arsitektur. Produksi berjalan di amd64.
- Menerbitkan dari tag rilis atau membuat GitHub Release.
