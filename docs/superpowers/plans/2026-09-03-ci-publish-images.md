# CI Publish Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiap push ke `main` menguji repo lalu mem-build dan mem-push image backend dan frontend ke GHCR, ditandai SHA commit.

**Architecture:** Satu workflow GitHub Actions dengan tiga job: `test-backend` (Postgres service + langkah pemanasan skema) dan `test-frontend` berjalan paralel, lalu `publish` yang membutuhkan keduanya hijau dan memanggil `deploy/build.sh --push` yang sudah ada.

**Tech Stack:** GitHub Actions, Docker, GHCR, Rust 1.97, bun 1.3.8, Postgres 17.

**Spec:** `docs/superpowers/specs/2026-09-03-ci-publish-images-design.md`

---

## Catatan penting sebelum mulai

**YAML workflow tidak bisa diuji tanpa dijalankan di GitHub.** Tidak ada test
lokal yang membuktikan sebuah workflow benar. Karena itu rencananya bertahap:
Task 1 menulis job test dan membuktikannya lewat **pull request**, Task 2 baru
menambahkan job publish, dan Task 3 memverifikasi publikasi setelah merge.

Urutan itu disengaja. PR menjalankan job test tanpa mem-publish apa pun, jadi
sintaks, service Postgres, langkah pemanasan, dan cache semuanya terbukti
**sebelum satu image pun terdorong ke registry**.

**Jangan push langsung ke `main` untuk menguji.** Push ke main memicu job publish.

## Fakta yang sudah dipastikan

Jangan tebak ulang; ini sudah diverifikasi:

| Hal | Nilai |
|---|---|
| SHA arke yang dipakai produksi | `bebc0bf4b85c668a5f828146292c97920da92231` |
| Repo arke | `dalfiannur/arke`, **publik** (tanpa token) |
| Rust di `backend.Dockerfile` | `1.97` |
| Bun di `frontend.Dockerfile` | `1.3.8` |
| `build.sh --push` mendorong | `:${SHA}` **dan** `:latest`, kedua image |
| Registry default `build.sh` | `ghcr.io/dalfiannur/task-management` |
| Workspace bun | root repo — `package.json` punya `workspaces: ["apps/*"]`, jadi `bun install` di root mencakup `apps/frontend` |
| `gh` CLI | terpasang (2.98.0), dipakai untuk membuka PR dan menonton run |

**Tata letak checkout wajib.** Direktori arke harus bernama **`rust-ecs`**, bukan
`arke`. Dari `task-management/apps/backend-rs/Cargo.toml`, dependensi path
`../../../rust-ecs` menunjuk ke induk root repo — jadi dengan kedua repo sebagai
subdirektori `$GITHUB_WORKSPACE`, ia resolve ke `$GITHUB_WORKSPACE/rust-ecs`.
`path:` milik `actions/checkout` juga tidak bisa keluar dari workspace, jadi
menaruh arke di luar bukan pilihan.

## File Structure

**Dibuat:**

| File | Tanggung jawab |
|---|---|
| `.github/workflows/publish-images.yml` | Seluruh pipeline: dua job test, satu job publish |

Tidak ada file lain yang diubah. `deploy/build.sh` dipakai apa adanya.

---

## Task 1: Job test, dibuktikan lewat PR

**Files:**
- Create: `.github/workflows/publish-images.yml`

- [ ] **Step 1: Tulis workflow dengan dua job test**

Buat `.github/workflows/publish-images.yml`:

```yaml
name: Publish images

# Push ke main mem-publish. Pull request hanya menguji — umpan balik tanpa
# mengotori registry.
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  packages: write

env:
  # `apps/backend-rs` bergantung pada arke lewat dependensi *path*, yang tidak
  # dikunci Cargo.lock. Tanpa SHA tersemat di sini, tidak ada apa pun yang
  # mencatat versi arke mana yang menghasilkan sebuah build. Menaikkannya harus
  # jadi commit yang terlihat, bukan pergeseran diam-diam.
  ARKE_SHA: bebc0bf4b85c668a5f828146292c97920da92231

jobs:
  test-backend:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: sedjiwa_tasks_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/sedjiwa_tasks_test
      AUTH_JWT_SECRET: ci-secret-not-used-outside-ci

    steps:
      # Kedua repo jadi subdirektori bernama, supaya `../../../rust-ecs` di
      # manifest resolve. Nama `rust-ecs` wajib — bukan `arke`.
      - uses: actions/checkout@v4
        with:
          path: task-management

      - uses: actions/checkout@v4
        with:
          repository: dalfiannur/arke
          ref: ${{ env.ARKE_SHA }}
          path: rust-ecs

      - uses: dtolnay/rust-toolchain@master
        with:
          toolchain: "1.97"

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: task-management/apps/backend-rs

      # Satu test lebih dulu, sendirian. `Store::connect` menyinkronkan seluruh
      # skema pada koneksi pertama; tanpa ini, binary test yang berjalan
      # bersamaan terhadap database kosong berebut membuat tabel komponen yang
      # sama dan gagal dengan `duplicate key value violates unique constraint
      # "pg_type_typname_nsp_index"`. Itu perilaku yang sudah diketahui: run
      # pertama terhadap database baru selalu gagal sekali. CI selalu dapat
      # database baru, jadi tanpa pemanasan ini setiap run gagal.
      - name: Warm up the database schema
        working-directory: task-management/apps/backend-rs
        run: cargo test -p mcp --test mcp_flow initialize_returns_capabilities

      - name: Test workspace
        working-directory: task-management/apps/backend-rs
        run: cargo test --workspace

  test-frontend:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.8"

      # Workspace bun ada di root repo, bukan di apps/frontend.
      - run: bun install --frozen-lockfile

      - run: bun run tsc --noEmit
        working-directory: apps/frontend

      - run: bun run lint
        working-directory: apps/frontend

      - run: bun run build
        working-directory: apps/frontend
```

- [ ] **Step 2: Validasi sintaksnya sebelum push**

`actionlint` **tidak terpasang di mesin ini** (sudah dicek). Pakai parse YAML:

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish-images.yml')); print('YAML OK')"`
Expected: `YAML OK`

Kalau kamu memang punya `actionlint`, jalankan juga — ia menangkap nama input
yang salah dan ekspresi yang tidak valid, yang tidak dilihat parse YAML.

Ini tidak membuktikan workflow-nya benar — hanya bahwa ia bukan YAML rusak.
Pembuktiannya ada di Step 4.

- [ ] **Step 3: Commit di branch dan buka PR**

```bash
git checkout -b ci/publish-images
git add .github/workflows/publish-images.yml
git commit -m "ci: test backend and frontend on push and pull request"
git push -u origin ci/publish-images
gh pr create --title "ci: build, test, and publish images to GHCR" \
  --body "Menutup celah yang membuat backend produksi tertinggal 33 commit: tidak ada yang mem-build image GHCR kecuali seseorang ingat menjalankannya dari mesinnya sendiri.

Task 1 menambahkan job test saja. Job publish menyusul di commit berikutnya di PR yang sama, supaya sintaks dan service Postgres terbukti sebelum ada image yang terdorong.

Spec: docs/superpowers/specs/2026-09-03-ci-publish-images-design.md"
```

- [ ] **Step 4: Tonton kedua job dan pastikan hijau**

Run: `gh run watch` (atau `gh run list --branch ci/publish-images`)

Expected: `test-backend` dan `test-frontend` keduanya sukses.

Yang paling mungkin gagal di percobaan pertama, dan artinya:

- **`test-backend` gagal dengan `pg_type_typname_nsp_index`** — langkah pemanasan
  tidak berjalan atau tidak menyentuh database. Periksa test yang dipanggil masih
  ada dan namanya benar.
- **Error `no such file` saat kompilasi arke** — tata letak checkout salah.
  Direktorinya harus persis `rust-ecs`.
- **`test-backend` "lulus" mencurigakan cepat** — `DATABASE_URL` tidak sampai ke
  test, sehingga flow test skip diam-diam dan tetap dilaporkan lulus. Periksa
  outputnya memuat penanda `SKIP`; kalau ada, env-nya tidak terpasang.
- **`bun install` gagal frozen-lockfile** — `bun.lock` tidak sinkron dengan
  `package.json`. Itu masalah repo, bukan workflow; laporkan, jangan longgarkan
  flag-nya.

Perbaiki, commit ke branch yang sama, dan tonton lagi sampai hijau. **Jangan
lanjut ke Task 2 sebelum kedua job hijau.**

---

## Task 2: Job publish

**Files:**
- Modify: `.github/workflows/publish-images.yml`

- [ ] **Step 1: Tambahkan job publish**

Tambahkan di akhir `jobs:` pada file yang sama:

```yaml
  publish:
    # Tidak ada image terbit dari commit yang test-nya merah.
    needs: [test-backend, test-frontend]
    # Job test berjalan untuk PR juga; publikasi hanya untuk main.
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          path: task-management

      - uses: actions/checkout@v4
        with:
          repository: dalfiannur/arke
          ref: ${{ env.ARKE_SHA }}
          path: rust-ecs

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # Memakai script yang sudah ada, bukan menulis ulang langkahnya di sini.
      # `build.sh` menyusun build context backend dari dua checkout, menandai
      # dengan SHA commit, dan menambahkan akhiran `-dirty` bila working tree
      # kotor. Menyalin logika itu ke YAML berarti dua tempat yang akan
      # menyimpang. Default ENGINE-nya podman; runner memakai docker.
      - name: Build and push images
        working-directory: task-management
        env:
          ENGINE: docker
          ARKE_DIR: ${{ github.workspace }}/rust-ecs
        run: ./deploy/build.sh --push
```

- [ ] **Step 2: Validasi sintaks lagi**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/publish-images.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit ke PR yang sama dan pastikan tetap hijau**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: publish images to GHCR when tests pass on main"
git push
```

Run: `gh run watch`

Expected: `test-backend` dan `test-frontend` sukses; **`publish` dilewati**
(skipped), karena ini event `pull_request`, bukan push ke `main`.

Kalau `publish` justru berjalan di PR, kondisi `if:`-nya salah — perbaiki
sebelum merge. Job itu akan mendorong image ke registry.

---

## Task 3: Merge dan verifikasi publikasi

**Files:** tidak ada yang diubah kecuali perbaikan yang ditemukan.

- [ ] **Step 1: Merge PR**

```bash
gh pr merge --merge
git checkout main && git pull
```

- [ ] **Step 2: Tonton job publish**

Run: `gh run watch`

Expected: ketiga job sukses. `publish` memakan menit — ia mengompilasi Rust dari
nol di dalam builder stage.

- [ ] **Step 3: Pastikan image benar-benar terbit dengan SHA commit itu**

```bash
SHA=$(git rev-parse --short HEAD)
docker manifest inspect ghcr.io/dalfiannur/task-management/backend:$SHA > /dev/null && echo "backend:$SHA OK"
docker manifest inspect ghcr.io/dalfiannur/task-management/frontend:$SHA > /dev/null && echo "frontend:$SHA OK"
```

Expected: keduanya `OK`.

Kalau tag-nya berakhiran `-dirty`, checkout di runner tidak bersih — itu bug
yang perlu dilaporkan, bukan diabaikan, karena artinya build tidak sesuai commit.

- [ ] **Step 4: Buktikan janji reproducibility**

Inilah alasan SHA arke disematkan. Build commit yang sama secara lokal dan
bandingkan digest-nya dengan yang dihasilkan CI:

```bash
ENGINE=docker ./deploy/build.sh
docker image inspect ghcr.io/dalfiannur/task-management/backend:$(git rev-parse --short HEAD) \
  --format '{{.Id}}'
docker manifest inspect ghcr.io/dalfiannur/task-management/backend:$(git rev-parse --short HEAD) \
  | grep -m1 digest
```

Expected: keduanya merujuk isi yang sama.

Catat apa yang sebenarnya terjadi. Build container **tidak dijamin**
bit-for-bit reproducible — timestamp, urutan layer, dan versi paket dasar bisa
berbeda. Kalau digest-nya berbeda, **jangan laporkan sebagai kegagalan**:
periksa apakah biner di dalamnya berperilaku sama, dan laporkan bahwa
reproducibility yang didapat adalah "sumber yang sama", bukan "byte yang sama".
Itu tetap yang dijanjikan penyematan SHA arke — ia menghapus pertanyaan *kode
mana* yang di-build, bukan menjamin output yang identik bit.

- [ ] **Step 5: Pastikan produksi tidak tersentuh**

CI hanya mem-publish. Konfirmasi produksi masih di tag yang di-deploy manual:

```bash
ssh uray@152.42.215.179 'docker ps --filter name=pm- --format "{{.Names}}\t{{.Image}}"'
```

Expected: keduanya masih `:b15c832`. Kalau berubah, ada sesuatu di workflow yang
menyentuh produksi dan itu harus dicabut segera.

- [ ] **Step 6: Commit perbaikan bila ada**

Kalau tidak ada temuan, lewati — jangan membuat commit kosong.
