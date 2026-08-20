//! Demo seed: a realistic, fully-linked dataset for local development.
//!
//! Creates a small software house ("Sedjiwa") with a staffed team, six projects
//! spanning the delivery lifecycle, and the modules/tasks/labels/comments/pages/
//! activity that a real portal would have accumulated around them. Dates are
//! anchored on 2026-08-20 so the board shows finished work in the past, work in
//! flight today, and planned work ahead.
//!
//! Destructive: run against an empty database (or accept duplicates). After it
//! finishes, run `cargo run --bin reindex` to populate `search_doc`.
//!
//! Env: `DATABASE_URL` (required).

use std::collections::HashMap;

use anyhow::{anyhow, Result};
use auth::hash_password;
use domain::activity::{ActivityAction, ActivityInfo, EntityType};
use domain::comment::CommentInfo;
use domain::label::LabelInfo;
use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
use domain::notification::{NotificationInfo, NotificationRefs, NotificationType};
use domain::page::{PageAudit, PageInfo};
use domain::project::{
    ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatus, ProjectStatusComponent,
};
use domain::task::{
    TaskAssignees, TaskAudit, TaskBlockedBy, TaskInfo, TaskLabels, TaskModuleRef, TaskParent,
    TaskPriority, TaskStatus,
};
use domain::user::{
    AdminMark, UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent,
};
use persistence::Store;

// ---------------------------------------------------------------------------
// Static dataset
// ---------------------------------------------------------------------------

/// `(phone, display_name, email, status, is_admin)`. Index = the `u!` handle
/// used by every project/task below.
const USERS: &[(&str, &str, &str, UserStatus, bool)] = &[
    ("0800000000", "Dikry Alfiannur", "dikry@sedjiwa.id", UserStatus::Active, true),
    ("081100000012", "Teguh Santoso", "teguh@sedjiwa.id", UserStatus::Active, true),
    ("081100000002", "Rizky Ramadhan", "rizky@sedjiwa.id", UserStatus::Active, false),
    ("081100000003", "Nadia Putri", "nadia@sedjiwa.id", UserStatus::Active, false),
    ("081100000004", "Bagus Wicaksono", "bagus@sedjiwa.id", UserStatus::Active, false),
    ("081100000005", "Sari Wulandari", "sari@sedjiwa.id", UserStatus::Active, false),
    ("081100000006", "Fajar Nugroho", "fajar@sedjiwa.id", UserStatus::Active, false),
    ("081100000007", "Anisa Rahmawati", "anisa@sedjiwa.id", UserStatus::Active, false),
    ("081100000008", "Yoga Pratama", "yoga@sedjiwa.id", UserStatus::Active, false),
    ("081100000009", "Dewi Lestari", "dewi@sedjiwa.id", UserStatus::Active, false),
    ("081100000010", "Arif Hidayat", "arif@sedjiwa.id", UserStatus::Active, false),
    ("081100000011", "Maya Safitri", "maya@sedjiwa.id", UserStatus::Active, false),
    ("081100000013", "Putri Ayu", "putri@sedjiwa.id", UserStatus::Pending, false),
    ("081100000014", "Hendra Gunawan", "hendra@sedjiwa.id", UserStatus::Suspended, false),
];

// Readable indices into USERS.
const DIKRY: usize = 0;
const TEGUH: usize = 1;
const RIZKY: usize = 2;
const NADIA: usize = 3;
const BAGUS: usize = 4;
const SARI: usize = 5;
const FAJAR: usize = 6;
const ANISA: usize = 7;
const YOGA: usize = 8;
const DEWI: usize = 9;
const ARIF: usize = 10;
const MAYA: usize = 11;

/// Label palette shared by every project (each project gets its own rows).
const LABELS: &[(&str, &str)] = &[
    ("bug", "#ef4444"),
    ("feature", "#3b82f6"),
    ("enhancement", "#8b5cf6"),
    ("urgent", "#f59e0b"),
    ("design", "#ec4899"),
    ("backend", "#10b981"),
    ("frontend", "#06b6d4"),
    ("docs", "#64748b"),
    ("tech-debt", "#78716c"),
];

/// A subtask: `(title, status, assignees)`.
type Sub = (&'static str, TaskStatus, &'static [usize]);

struct T {
    title: &'static str,
    desc: &'static str,
    status: TaskStatus,
    prio: TaskPriority,
    start: Option<&'static str>,
    due: Option<&'static str>,
    assignees: &'static [usize],
    labels: &'static [&'static str],
    subtasks: &'static [Sub],
    /// Titles of sibling tasks (same project) that must finish first.
    blocked_by: &'static [&'static str],
}

struct M {
    name: &'static str,
    desc: &'static str,
    tasks: &'static [T],
}

struct P {
    name: &'static str,
    desc: &'static str,
    owner: usize,
    status: ProjectStatus,
    start: &'static str,
    end: &'static str,
    members: &'static [usize],
    modules: &'static [M],
    pages: &'static [(&'static str, &'static str, &'static str, usize)], // title, icon, md, author
    /// `(task_title, author, content, created_at)`
    comments: &'static [(&'static str, usize, &'static str, &'static str)],
}

/// Shorthand for the common "no subtasks / no deps" task.
const NO_SUBS: &[Sub] = &[];
const NO_DEPS: &[&str] = &[];

const PROJECTS: &[P] = &[
    // ---------------------------------------------------------------- P1
    P {
        name: "Sedjiwa Portal — Core Revamp",
        desc: "Perombakan total portal internal Sedjiwa: design system baru, navigasi yang lebih ringkas, dan pemisahan modul project/task agar tiap tim bisa jalan sendiri tanpa saling blokir.",
        owner: TEGUH,
        status: ProjectStatus::Active,
        start: "2026-03-02",
        end: "2026-10-07",
        members: &[DIKRY, TEGUH, RIZKY, NADIA, BAGUS, SARI, FAJAR, ANISA, YOGA, DEWI, MAYA],
        modules: &[
            M {
                name: "Discovery & Riset",
                desc: "Menggali pain point portal lama sebelum satu baris kode ditulis.",
                tasks: &[
                    T {
                        title: "Wawancara 8 user internal soal pain point portal lama",
                        desc: "Sesi 45 menit per orang, lintas divisi (sales, ops, finance, engineering). Rekam, transkrip, dan tandai keluhan yang muncul di lebih dari tiga sesi.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-03-02"),
                        due: Some("2026-03-13"),
                        assignees: &[DEWI],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Audit fitur portal lama & inventaris modul",
                        desc: "Daftar semua modul yang masih dipakai beserta jumlah user aktif per bulan. Modul dengan nol pemakaian selama 6 bulan diusulkan untuk dimatikan.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-02"),
                        due: Some("2026-03-13"),
                        assignees: &[DEWI, RIZKY],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Susun PRD Core Revamp v1",
                        desc: "Ruang lingkup, non-goal, metrik keberhasilan, dan urutan rilis. Ditandatangani PM + Tech Lead sebelum masuk fase desain.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-16"),
                        due: Some("2026-03-27"),
                        assignees: &[RIZKY],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Audit fitur portal lama & inventaris modul"],
                    },
                ],
            },
            M {
                name: "Desain UI/UX",
                desc: "Design system dulu, layar menyusul — supaya komponen tidak dibuat dua kali.",
                tasks: &[
                    T {
                        title: "Design system: token warna, tipografi, spacing",
                        desc: "Token diekspor ke CSS variable agar Tailwind dan Figma memakai sumber angka yang sama. Termasuk skala spacing 4px dan dua tema (light/dark).",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-30"),
                        due: Some("2026-04-17"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: &[
                            ("Palet warna + kontras WCAG AA", TaskStatus::Done, &[NADIA]),
                            ("Skala tipografi & line-height", TaskStatus::Done, &[NADIA]),
                            ("Export token ke CSS variable", TaskStatus::Done, &[NADIA, BAGUS]),
                        ],
                        blocked_by: &["Susun PRD Core Revamp v1"],
                    },
                    T {
                        title: "Wireframe dashboard & navigasi utama",
                        desc: "Low-fidelity dulu untuk menguji hierarki menu. Target: user menemukan project miliknya dalam maksimal dua klik.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-04-20"),
                        due: Some("2026-05-01"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Design system: token warna, tipografi, spacing"],
                    },
                    T {
                        title: "Hi-fi mockup halaman Project Detail",
                        desc: "Lima tab (All Tasks, Timeline, Members, Media, Pages) dengan status kosong, status loading, dan status error digambar semua — bukan cuma happy path.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-05-04"),
                        due: Some("2026-05-22"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Wireframe dashboard & navigasi utama"],
                    },
                    T {
                        title: "Prototype interaktif untuk user testing",
                        desc: "Prototype Figma yang bisa diklik untuk lima alur utama. Dipakai uji coba ke 6 user internal minggu depan.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-23"),
                        assignees: &[NADIA, DEWI],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                ],
            },
            M {
                name: "Frontend",
                desc: "React 19 + TanStack Router/Query, Connect sebagai satu-satunya jalur ke server.",
                tasks: &[
                    T {
                        title: "Setup Vite + React 19 + TanStack Router",
                        desc: "Struktur folder per fitur, path alias @/*, file-based routing, dan konfigurasi proxy dev ke backend-rs di :3010.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-02"),
                        due: Some("2026-03-06"),
                        assignees: &[BAGUS],
                        labels: &["frontend"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Implementasi AppShell & sidebar navigasi",
                        desc: "Layout utama dengan sidebar yang bisa dilipat, breadcrumb dinamis dari route, dan drawer untuk layar kecil.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-03-09"),
                        due: Some("2026-03-20"),
                        assignees: &[BAGUS, MAYA],
                        labels: &["frontend"],
                        subtasks: &[
                            ("State collapse sidebar disimpan di localStorage", TaskStatus::Done, &[BAGUS]),
                            ("Breadcrumb dinamis dari route tree", TaskStatus::Done, &[MAYA]),
                            ("Drawer responsif untuk mobile", TaskStatus::Done, &[MAYA]),
                        ],
                        blocked_by: &["Setup Vite + React 19 + TanStack Router"],
                    },
                    T {
                        title: "Halaman daftar & detail project",
                        desc: "Grid project dengan filter status, plus shell halaman detail beserta lima tab-nya.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-05-25"),
                        due: Some("2026-06-12"),
                        assignees: &[MAYA],
                        labels: &["frontend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Implementasi AppShell & sidebar navigasi", "Hi-fi mockup halaman Project Detail"],
                    },
                    T {
                        title: "Timeline view dengan dependency arrow",
                        desc: "Gantt ringan: satu baris per task, drag untuk menggeser jadwal, panah finish-to-start antar task, dan penanda merah kalau dependency-nya bentrok.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::High,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-24"),
                        assignees: &[BAGUS],
                        labels: &["frontend", "feature"],
                        subtasks: &[
                            ("Render bar per task di sumbu waktu", TaskStatus::Done, &[BAGUS]),
                            ("Drag untuk reschedule + clamp tanggal", TaskStatus::Done, &[BAGUS]),
                            ("Panah dependency & deteksi konflik", TaskStatus::InProgress, &[BAGUS]),
                            ("Zoom harian / mingguan / bulanan", TaskStatus::Todo, &[MAYA]),
                        ],
                        blocked_by: &["Halaman daftar & detail project"],
                    },
                    T {
                        title: "Global search dengan hasil berkelompok",
                        desc: "Satu kotak pencarian untuk task, page, comment, project, dan user. Hasil dikelompokkan per jenis, dengan navigasi keyboard.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-13"),
                        due: Some("2026-09-06"),
                        assignees: &[MAYA],
                        labels: &["frontend", "feature"],
                        subtasks: &[
                            ("Debounce input & batalkan request lama", TaskStatus::Done, &[MAYA]),
                            ("Kelompokkan hasil per jenis dokumen", TaskStatus::InProgress, &[MAYA]),
                            ("Navigasi hasil dengan panah + Enter", TaskStatus::Todo, &[MAYA]),
                        ],
                        blocked_by: &["Full-text search index (search_doc)"],
                    },
                    T {
                        title: "Dark mode di seluruh halaman",
                        desc: "Ikut preferensi sistem, dengan override manual yang disimpan per user. Semua warna wajib lewat token — tidak ada hex hardcoded.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Low,
                        start: Some("2026-08-24"),
                        due: Some("2026-09-11"),
                        assignees: &[MAYA],
                        labels: &["frontend", "enhancement"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                ],
            },
            M {
                name: "Backend & API",
                desc: "Rust + Arke ECS, Connect/gRPC-web sebagai kontrak ke frontend.",
                tasks: &[
                    T {
                        title: "Definisi proto untuk Project & Task service",
                        desc: "Skema proto yang jadi satu-satunya kontrak antara FE dan BE. Enum pakai nilai eksplisit supaya aman saat ditambah field.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-30"),
                        due: Some("2026-04-10"),
                        assignees: &[SARI, TEGUH],
                        labels: &["backend", "docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Susun PRD Core Revamp v1"],
                    },
                    T {
                        title: "Endpoint CRUD project + membership",
                        desc: "Create/update/archive project, tambah dan keluarkan member, serta transfer ownership dengan pencatatan di activity log.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-04-13"),
                        due: Some("2026-05-01"),
                        assignees: &[SARI],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Definisi proto untuk Project & Task service"],
                    },
                    T {
                        title: "Endpoint task, subtask, dan dependency",
                        desc: "Subtask dibatasi satu level supaya siklus mustahil terbentuk secara struktural, bukan sekadar dicegah validasi.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-05-04"),
                        due: Some("2026-05-29"),
                        assignees: &[FAJAR],
                        labels: &["backend"],
                        subtasks: &[
                            ("Validasi assignee harus member project", TaskStatus::Done, &[FAJAR]),
                            ("Aturan satu level untuk subtask", TaskStatus::Done, &[FAJAR]),
                            ("Clamp tanggal saat reschedule", TaskStatus::Done, &[FAJAR]),
                        ],
                        blocked_by: &["Endpoint CRUD project + membership"],
                    },
                    T {
                        title: "Full-text search index (search_doc)",
                        desc: "Tabel turunan berisi lima jenis dokumen, ditulis best-effort di jalur write, plus binary reindex untuk backfill dan perbaikan drift.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::High,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-25"),
                        assignees: &[FAJAR],
                        labels: &["backend", "feature"],
                        subtasks: &[
                            ("Skema tabel + index tsvector", TaskStatus::Done, &[FAJAR]),
                            ("Indexer di jalur write", TaskStatus::Done, &[FAJAR]),
                            ("Binary reindex untuk backfill", TaskStatus::Done, &[FAJAR]),
                            ("Filter hasil berdasarkan membership", TaskStatus::InProgress, &[FAJAR, SARI]),
                        ],
                        blocked_by: &["Endpoint task, subtask, dan dependency"],
                    },
                    T {
                        title: "Rate limiting & audit log per endpoint",
                        desc: "Batas per user per menit untuk endpoint tulis, dan catatan audit siapa mengubah apa. Wajib ada sebelum portal dibuka ke luar tim.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-24"),
                        due: Some("2026-09-11"),
                        assignees: &[SARI],
                        labels: &["backend", "tech-debt"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                ],
            },
            M {
                name: "QA & Release",
                desc: "Gerbang terakhir sebelum portal dipakai satu kantor.",
                tasks: &[
                    T {
                        title: "Test plan regresi untuk modul project",
                        desc: "Skenario manual untuk alur kritis, plus daftar kasus yang layak diotomasi di iterasi berikutnya.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-26"),
                        assignees: &[ANISA],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Bug: hasil search subtask menampilkan project, bukan parent task",
                        desc: "Di daftar hasil pencarian, subtask menampilkan nama project sebagai konteks sehingga dua subtask berbeda terlihat identik. Seharusnya menampilkan judul task induknya.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-03-02"),
                        due: Some("2026-03-04"),
                        assignees: &[MAYA, ANISA],
                        labels: &["bug", "urgent"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Bug: hapus task dengan subtask tidak minta konfirmasi",
                        desc: "Menghapus task induk langsung menghapus semua subtask tanpa peringatan. Tambahkan dialog yang menyebut jumlah subtask yang ikut terhapus.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-02"),
                        due: Some("2026-03-05"),
                        assignees: &[BAGUS],
                        labels: &["bug"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Load test 500 concurrent user",
                        desc: "Skenario campuran baca-tulis dengan k6. Target p95 di bawah 400ms untuk endpoint daftar task.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::High,
                        start: Some("2026-09-14"),
                        due: Some("2026-09-25"),
                        assignees: &[YOGA],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Rate limiting & audit log per endpoint"],
                    },
                    T {
                        title: "Deploy staging & UAT bersama tim ops",
                        desc: "Rilis ke staging, pandu UAT dua minggu, kumpulkan temuan di satu papan sebelum go-live.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::High,
                        start: Some("2026-09-28"),
                        due: Some("2026-10-07"),
                        assignees: &[YOGA, TEGUH, DIKRY],
                        labels: &[],
                        subtasks: NO_SUBS,
                        blocked_by: &["Load test 500 concurrent user", "Test plan regresi untuk modul project"],
                    },
                ],
            },
        ],
        pages: &[
            (
                "PRD — Core Revamp",
                "📋",
                "<h1>PRD — Sedjiwa Portal Core Revamp</h1><h2>Latar belakang</h2><p>Portal lama tumbuh tanpa arah selama tiga tahun. Setiap divisi menambah modulnya sendiri, dan sekarang ada 14 modul yang saling tumpang tindih — enam di antaranya tidak tersentuh selama enam bulan terakhir.</p><h2>Tujuan</h2><ol><li>Satu design system untuk semua modul.</li><li>User menemukan project miliknya dalam maksimal dua klik.</li><li>Waktu muat halaman project detail di bawah 1,5 detik pada koneksi kantor.</li></ol><h2>Non-goal</h2><ul><li>Migrasi data historis dari portal lama (ditangani terpisah).</li><li>Aplikasi mobile (lihat project Aplikasi Mobile Sedjiwa).</li></ul><h2>Metrik keberhasilan</h2><ul><li><strong>Waktu cari project</strong> — Baseline: 42 detik · Target: &lt; 10 detik</li><li><strong>Modul aktif</strong> — Baseline: 14 · Target: 8</li><li><strong>Keluhan navigasi / bulan</strong> — Baseline: 23 · Target: &lt; 5</li></ul>",
                RIZKY,
            ),
            (
                "Catatan Meeting Mingguan",
                "🗓️",
                "<h1>Catatan Meeting Mingguan</h1><h2>18 Agustus 2026</h2><p><strong>Hadir:</strong> Teguh, Rizky, Nadia, Bagus, Maya, Fajar, Anisa</p><ul><li>Timeline view sudah bisa drag, panah dependency masih digarap Bagus. Perkiraan selesai akhir minggu ini.</li><li>Filter membership di search jadi blocker untuk Maya — Fajar target selesai Kamis.</li><li>Dua bug dari UAT internal sudah ditutup (search subtask, konfirmasi hapus).</li><li><strong>Keputusan:</strong> dark mode digeser ke setelah go-live. Tidak menahan rilis.</li></ul><h2>11 Agustus 2026</h2><p><strong>Hadir:</strong> Teguh, Rizky, Nadia, Bagus, Sari, Yoga</p><ul><li>Sari menaikkan isu rate limiting sebelum portal dibuka ke luar tim. Disetujui masuk scope.</li><li>Load test dijadwalkan setelah rate limiting siap, bukan sebelumnya.</li><li>Nadia mulai prototype untuk user testing, target 6 responden.</li></ul>",
                TEGUH,
            ),
            (
                "Spesifikasi Teknis",
                "🛠️",
                "<h1>Spesifikasi Teknis</h1><h2>Arsitektur</h2><pre><code>Frontend (Vite + React 19)\n   └── Connect / gRPC-web  →  backend-rs (Rust + Arke ECS)\n                                    └── PostgreSQL</code></pre><h2>Keputusan penting</h2><h3>Kenapa Connect, bukan GraphQL?</h3><p>Skema proto memberi kontrak yang dicek compiler di kedua sisi. Dengan GraphQL kami tetap harus menulis codegen sendiri, dan tidak ada yang benar-benar butuh query fleksibel dari klien.</p><h3>Kenapa subtask dibatasi satu level?</h3><p>Hierarki tanpa batas berarti harus mendeteksi siklus di setiap penulisan. Dengan satu level, siklus mustahil terbentuk secara struktural — aturannya cukup ditegakkan di handler.</p><h3>Dependency disimpan satu arah</h3><p><code>TaskBlockedBy</code> hanya menyimpan arah \"apa yang memblokir saya\". Arah sebaliknya dihitung di frontend dari daftar task yang sudah termuat, jadi tidak ada indeks terbalik yang perlu dijaga konsistensinya.</p>",
                TEGUH,
            ),
        ],
        comments: &[
            ("Timeline view dengan dependency arrow", NADIA, "<p>Panahnya jangan siku-siku ya, pakai kurva bezier biar tidak berantakan kalau task-nya berdekatan. Sudah kugambar di frame <code>Timeline / Arrows</code> di Figma.</p>", "2026-08-12T09:14:00Z"),
            ("Timeline view dengan dependency arrow", BAGUS, "<p>Sudah pakai bezier. Yang masih kupikirkan: kalau dua task overlap dan panahnya menumpuk, apa perlu di-offset otomatis atau cukup dibiarkan?</p>", "2026-08-12T11:02:00Z"),
            ("Timeline view dengan dependency arrow", TEGUH, "<p>Biarkan dulu. Kalau nanti banyak yang komplain baru kita offset — jangan tambah kompleksitas sebelum ada yang mengeluh.</p>", "2026-08-12T13:40:00Z"),
            ("Global search dengan hasil berkelompok", MAYA, "<p>Ini masih nunggu filter membership dari sisi backend. Sementara hasilnya bocor lintas project kalau user-nya bukan member.</p>", "2026-08-14T10:25:00Z"),
            ("Global search dengan hasil berkelompok", FAJAR, "<p>Lagi kugarap, target Kamis. Filternya di level query <code>search_doc</code>, bukan di aplikasi — biar tidak ada jalur yang kelewat.</p>", "2026-08-14T14:08:00Z"),
            ("Bug: hasil search subtask menampilkan project, bukan parent task", ANISA, "<p>Reproduksi: cari \"drag\", muncul dua hasil dengan konteks \"Sedjiwa Portal — Core Revamp\" yang tidak bisa dibedakan. Harusnya menampilkan judul task induk.</p>", "2026-08-13T08:30:00Z"),
            ("Bug: hasil search subtask menampilkan project, bukan parent task", MAYA, "<p>Sudah diperbaiki. Indexer sekarang menyimpan <code>parent_title</code> untuk subtask, dan UI pakai itu kalau ada. Sudah kuverifikasi di staging.</p>", "2026-08-15T16:45:00Z"),
            ("Full-text search index (search_doc)", SARI, "<p>Catatan: kalau indexer gagal, jangan retry di jalur write. Cukup log — reindex sudah menangani drift, dan retry cuma bikin request tulis jadi lambat.</p>", "2026-08-05T09:00:00Z"),
            ("Rate limiting & audit log per endpoint", TEGUH, "<p>Prioritaskan endpoint tulis dulu. Endpoint baca bisa menyusul setelah go-live.</p>", "2026-08-18T15:20:00Z"),
            ("Prototype interaktif untuk user testing", DEWI, "<p>Sudah kujadwalkan 6 responden untuk minggu depan: 2 sales, 2 ops, 1 finance, 1 engineering. Slot masing-masing 45 menit.</p>", "2026-08-17T11:10:00Z"),
        ],
    },
    // ---------------------------------------------------------------- P2
    P {
        name: "Migrasi Backend ke Rust",
        desc: "Memindahkan backend dari Bun/GraphQL ke Rust dengan Arke ECS dan Connect. Dikerjakan bertahap per service, dengan periode dua backend berjalan berdampingan sebelum cutover.",
        owner: FAJAR,
        status: ProjectStatus::Active,
        start: "2026-05-04",
        end: "2026-11-27",
        members: &[DIKRY, FAJAR, SARI, TEGUH, YOGA, ANISA],
        modules: &[
            M {
                name: "Analisa & Perencanaan",
                desc: "Memetakan apa yang ada sebelum memindahkan apa pun.",
                tasks: &[
                    T {
                        title: "Inventaris seluruh resolver GraphQL yang masih dipakai",
                        desc: "Ambil dari log query 90 hari terakhir. Resolver tanpa trafik tidak ikut dimigrasi — langsung dimatikan saat cutover.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-05-04"),
                        due: Some("2026-05-15"),
                        assignees: &[FAJAR],
                        labels: &["docs", "backend"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Benchmark Bun vs Rust untuk endpoint terberat",
                        desc: "Bandingkan endpoint daftar task dengan 10 ribu baris. Ukur p50/p95 dan penggunaan memori, bukan cuma rata-rata.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-05-04"),
                        due: Some("2026-05-15"),
                        assignees: &[FAJAR, YOGA],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Rencana cutover bertahap per service",
                        desc: "Urutan migrasi, kriteria rollback per tahap, dan berapa lama dua backend jalan berdampingan.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-05-18"),
                        due: Some("2026-05-29"),
                        assignees: &[FAJAR, TEGUH],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Inventaris seluruh resolver GraphQL yang masih dipakai"],
                    },
                ],
            },
            M {
                name: "Fondasi Arke ECS",
                desc: "Lapisan dasar yang dipakai semua service setelahnya.",
                tasks: &[
                    T {
                        title: "Integrasi arke-postgres & auto-migrate komponen",
                        desc: "Registrasi komponen di satu tempat (`register_all`) supaya server dan seluruh binary memakai skema yang sama.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-06-01"),
                        due: Some("2026-06-19"),
                        assignees: &[FAJAR],
                        labels: &["backend"],
                        subtasks: &[
                            ("Derive PgComponent untuk semua komponen domain", TaskStatus::Done, &[FAJAR]),
                            ("Auto-migrate saat connect", TaskStatus::Done, &[FAJAR]),
                            ("Index untuk kolom yang sering difilter", TaskStatus::Done, &[SARI]),
                        ],
                        blocked_by: &["Rencana cutover bertahap per service"],
                    },
                    T {
                        title: "Setup connectrpc-axum & build proto",
                        desc: "build.rs yang menghasilkan kode Connect dari proto, plus handler dasar dan health check.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-05-04"),
                        due: Some("2026-05-22"),
                        assignees: &[SARI],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Auth: JWT lokal menggantikan OIDC Sedjiwa",
                        desc: "Identitas jadi mandiri: user lokal, login pakai nomor telepon + password (argon2), token HS256. Tidak ada lagi ketergantungan ke provider OIDC.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-05-25"),
                        due: Some("2026-06-19"),
                        assignees: &[SARI, FAJAR],
                        labels: &["backend", "feature"],
                        subtasks: &[
                            ("Hash password dengan argon2", TaskStatus::Done, &[SARI]),
                            ("Sign & verify JWT HS256", TaskStatus::Done, &[SARI]),
                            ("Guard requireUser / requireAdmin", TaskStatus::Done, &[FAJAR]),
                            ("Interceptor auth di sisi frontend", TaskStatus::Done, &[FAJAR]),
                        ],
                        blocked_by: &["Setup connectrpc-axum & build proto"],
                    },
                ],
            },
            M {
                name: "Migrasi Service",
                desc: "Satu service per waktu, masing-masing dengan tes sebelum lanjut.",
                tasks: &[
                    T {
                        title: "Migrasi ProjectService & UserDirectoryService",
                        desc: "Dua service pertama sekaligus jadi uji coba pola migrasi untuk sisanya.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-06-22"),
                        due: Some("2026-07-17"),
                        assignees: &[SARI],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Auth: JWT lokal menggantikan OIDC Sedjiwa"],
                    },
                    T {
                        title: "Migrasi WorkService (task, module, dependency)",
                        desc: "Service paling besar. Termasuk aturan subtask satu level dan validasi tanggal.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-07-20"),
                        due: Some("2026-08-14"),
                        assignees: &[FAJAR],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Migrasi ProjectService & UserDirectoryService"],
                    },
                    T {
                        title: "Migrasi NotificationService dengan server streaming",
                        desc: "Streaming RPC, bukan polling. Klien membuka stream sekali dan menerima notifikasi selama koneksi hidup.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-17"),
                        due: Some("2026-08-27"),
                        assignees: &[FAJAR],
                        labels: &["backend", "feature"],
                        subtasks: &[
                            ("Endpoint stream dengan cancel yang bersih", TaskStatus::Done, &[FAJAR]),
                            ("Tangani reconnect di sisi klien", TaskStatus::InProgress, &[FAJAR]),
                            ("Abaikan ConnectError Canceled saat unmount", TaskStatus::Todo, &[FAJAR]),
                        ],
                        blocked_by: &["Migrasi WorkService (task, module, dependency)"],
                    },
                    T {
                        title: "Migrasi MediaService & integrasi S3",
                        desc: "Upload lewat presigned URL langsung ke RustFS, backend hanya mencatat metadata.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-24"),
                        due: Some("2026-09-18"),
                        assignees: &[SARI],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Migrasi WorkService (task, module, dependency)"],
                    },
                    T {
                        title: "Migrasi ActivityService & CommentService",
                        desc: "Dua service terakhir sebelum backend lama bisa dimatikan.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-09-21"),
                        due: Some("2026-10-16"),
                        assignees: &[FAJAR],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Migrasi MediaService & integrasi S3"],
                    },
                ],
            },
            M {
                name: "Cutover & Monitoring",
                desc: "Mematikan backend lama tanpa ada yang sadar.",
                tasks: &[
                    T {
                        title: "Pipeline CI: build, test, clippy, deploy",
                        desc: "Cache target directory supaya build tidak makan 10 menit tiap push.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-28"),
                        assignees: &[YOGA],
                        labels: &["tech-debt"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Dashboard monitoring: latensi, error rate, koneksi DB",
                        desc: "Alert kalau p95 melewati 500ms atau error rate di atas 1% selama lima menit berturut-turut.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::High,
                        start: Some("2026-08-31"),
                        due: Some("2026-09-18"),
                        assignees: &[YOGA],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Pipeline CI: build, test, clippy, deploy"],
                    },
                    T {
                        title: "Matikan backend Bun & bersihkan dependensi",
                        desc: "Setelah dua minggu tanpa trafik ke backend lama, hapus service-nya dan bersihkan sisa paket GraphQL di repo.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Low,
                        start: Some("2026-10-19"),
                        due: Some("2026-11-06"),
                        assignees: &[FAJAR, YOGA],
                        labels: &["tech-debt"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Migrasi ActivityService & CommentService", "Dashboard monitoring: latensi, error rate, koneksi DB"],
                    },
                ],
            },
        ],
        pages: &[
            (
                "Rencana Cutover",
                "🚦",
                "<h1>Rencana Cutover</h1><h2>Urutan migrasi</h2><ol><li><strong>Project &amp; UserDirectory</strong> — paling sedikit dependensi, jadi kelinci percobaan pola migrasi. ✅</li><li><strong>Work (task/module)</strong> — paling besar, dikerjakan setelah polanya terbukti. ✅</li><li><strong>Notification</strong> — butuh streaming, agak beda dari yang lain. 🚧</li><li><strong>Media</strong> — bergantung ke S3, bisa paralel dengan Notification.</li><li><strong>Activity &amp; Comment</strong> — paling ringan, ditinggal terakhir.</li></ol><h2>Kriteria rollback</h2><p>Setiap tahap boleh di-rollback kalau salah satu terpenuhi dalam 48 jam pertama:</p><ul><li>Error rate di atas 2%.</li><li>p95 lebih buruk 30% dibanding backend lama.</li><li>Ada kehilangan data yang tidak bisa direkonsiliasi.</li></ul><h2>Periode berdampingan</h2><p>Dua backend jalan bersamaan minimal <strong>dua minggu</strong> per tahap. Frontend diarahkan ke Rust; backend Bun tetap hidup dan menerima trafik nol, sebagai jaring pengaman.</p>",
                FAJAR,
            ),
            (
                "Hasil Benchmark",
                "📊",
                "<h1>Hasil Benchmark — Bun vs Rust</h1><p>Endpoint: daftar task, 10.000 baris, 100 concurrent.</p><ul><li><strong>p50</strong> — Bun/GraphQL: 184 ms · Rust/Connect: 41 ms</li><li><strong>p95</strong> — Bun/GraphQL: 612 ms · Rust/Connect: 96 ms</li><li><strong>p99</strong> — Bun/GraphQL: 1.240 ms · Rust/Connect: 148 ms</li><li><strong>Memori (RSS)</strong> — Bun/GraphQL: 412 MB · Rust/Connect: 87 MB</li></ul><h2>Catatan</h2><p>Selisih terbesar ada di p99, bukan p50 — yang paling terasa buat user justru ekornya. Sebagian besar keunggulan datang dari hilangnya lapisan resolver GraphQL, bukan dari Rust-nya sendiri.</p><p>Benchmark dijalankan di mesin staging (4 vCPU, 8 GB), Postgres di host yang sama.</p>",
                FAJAR,
            ),
        ],
        comments: &[
            ("Migrasi NotificationService dengan server streaming", TEGUH, "<p>Pastikan stream-nya benar-benar tertutup saat komponen unmount. Kalau tidak, koneksi menumpuk dan pool Postgres habis dalam beberapa jam.</p>", "2026-08-13T10:30:00Z"),
            ("Migrasi NotificationService dengan server streaming", FAJAR, "<p>Sudah pakai AbortSignal dari <code>for await</code>. Yang masih kurang: menelan ConnectError dengan code Canceled supaya tidak muncul sebagai error palsu di console.</p>", "2026-08-13T14:15:00Z"),
            ("Pipeline CI: build, test, clippy, deploy", YOGA, "<p>Build pertama 11 menit, setelah cache aktif turun jadi 2 menit 40 detik. Masih bisa dipangkas kalau kita split job test dan clippy.</p>", "2026-08-19T09:45:00Z"),
            ("Integrasi arke-postgres & auto-migrate komponen", SARI, "<p>Perlu index di <code>project_id</code> dan <code>module_id</code> — tanpa itu daftar task jadi sequential scan begitu datanya lewat beberapa ribu baris.</p>", "2026-06-15T13:20:00Z"),
        ],
    },
    // ---------------------------------------------------------------- P3
    P {
        name: "Aplikasi Mobile Sedjiwa",
        desc: "Aplikasi mobile untuk tim lapangan: lihat task yang ditugaskan, ubah status, dan unggah foto bukti pekerjaan — semuanya harus tetap jalan saat sinyal hilang.",
        owner: RIZKY,
        status: ProjectStatus::Active,
        start: "2026-06-01",
        end: "2027-01-29",
        members: &[RIZKY, ARIF, NADIA, ANISA, TEGUH, SARI],
        modules: &[
            M {
                name: "Riset Produk",
                desc: "Memahami kondisi kerja tim lapangan sebelum menentukan fitur.",
                tasks: &[
                    T {
                        title: "Observasi lapangan bersama 3 tim teknisi",
                        desc: "Ikut satu hari penuh dengan tiga tim berbeda. Catat kapan mereka membuka HP, dan dalam kondisi apa (sinyal, sarung tangan, terik).",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-06-01"),
                        due: Some("2026-06-12"),
                        assignees: &[RIZKY, NADIA],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Tentukan fitur MVP & yang ditunda",
                        desc: "Temuan lapangan jelas: offline bukan fitur tambahan, tapi syarat. Chat dan laporan ditunda ke fase dua.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-06-15"),
                        due: Some("2026-06-26"),
                        assignees: &[RIZKY],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Observasi lapangan bersama 3 tim teknisi"],
                    },
                ],
            },
            M {
                name: "Desain Mobile",
                desc: "Desain untuk layar kecil, tangan kotor, dan sinyal seadanya.",
                tasks: &[
                    T {
                        title: "Adaptasi design system ke mobile",
                        desc: "Target sentuh minimal 48px, kontras dinaikkan untuk kondisi terik, dan ikon diperbesar.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-06-29"),
                        due: Some("2026-07-17"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Tentukan fitur MVP & yang ditunda"],
                    },
                    T {
                        title: "Desain alur offline & indikator sinkronisasi",
                        desc: "User harus selalu tahu status datanya: tersimpan lokal, sedang dikirim, atau sudah sampai server. Tanpa itu mereka mengisi ulang form yang sebenarnya sudah masuk.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-07-20"),
                        due: Some("2026-08-07"),
                        assignees: &[NADIA, RIZKY],
                        labels: &["design", "feature"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Adaptasi design system ke mobile"],
                    },
                    T {
                        title: "Desain layar unggah foto bukti pekerjaan",
                        desc: "Kamera langsung dari aplikasi, kompresi otomatis, antrean unggah yang terlihat jelas.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-29"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                ],
            },
            M {
                name: "Development",
                desc: "React Native, satu basis kode untuk dua platform.",
                tasks: &[
                    T {
                        title: "Setup project React Native & pipeline build",
                        desc: "Build otomatis untuk iOS dan Android, distribusi internal lewat TestFlight dan Firebase App Distribution.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-06-01"),
                        due: Some("2026-06-19"),
                        assignees: &[ARIF],
                        labels: &["frontend"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Login & penyimpanan token yang aman",
                        desc: "Token disimpan di Keychain (iOS) dan EncryptedSharedPreferences (Android), bukan AsyncStorage.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-06-22"),
                        due: Some("2026-07-03"),
                        assignees: &[ARIF],
                        labels: &["frontend", "backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Setup project React Native & pipeline build"],
                    },
                    T {
                        title: "Daftar task saya & ubah status dari HP",
                        desc: "Layar utama aplikasi. Task yang ditugaskan ke user, diurutkan berdasarkan jatuh tempo, dengan aksi cepat ubah status.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::High,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-30"),
                        assignees: &[ARIF],
                        labels: &["frontend", "feature"],
                        subtasks: &[
                            ("Daftar task + pull to refresh", TaskStatus::Done, &[ARIF]),
                            ("Aksi cepat ubah status", TaskStatus::InProgress, &[ARIF]),
                            ("Filter berdasarkan project", TaskStatus::Todo, &[ARIF]),
                        ],
                        blocked_by: &["Login & penyimpanan token yang aman"],
                    },
                    T {
                        title: "Mode offline dengan antrean sinkronisasi",
                        desc: "Perubahan disimpan lokal di SQLite dan dikirim ulang saat sinyal kembali. Konflik diselesaikan dengan aturan last-write-wins per field, bukan per record.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-08-31"),
                        due: Some("2026-10-09"),
                        assignees: &[ARIF, SARI],
                        labels: &["frontend", "feature"],
                        subtasks: &[
                            ("Skema SQLite lokal", TaskStatus::Todo, &[ARIF]),
                            ("Antrean operasi tertunda", TaskStatus::Todo, &[ARIF]),
                            ("Resolusi konflik per field", TaskStatus::Todo, &[ARIF, SARI]),
                            ("Indikator status sinkronisasi", TaskStatus::Todo, &[ARIF]),
                        ],
                        blocked_by: &["Daftar task saya & ubah status dari HP", "Desain alur offline & indikator sinkronisasi"],
                    },
                    T {
                        title: "Unggah foto dengan kompresi & antrean",
                        desc: "Foto dikompresi di perangkat sebelum diunggah — tim lapangan sering di jaringan 3G dan kuota terbatas.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-10-12"),
                        due: Some("2026-11-06"),
                        assignees: &[ARIF],
                        labels: &["frontend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Mode offline dengan antrean sinkronisasi"],
                    },
                    T {
                        title: "Push notification untuk task baru",
                        desc: "FCM untuk Android, APNs untuk iOS. Notifikasi hanya untuk task yang ditugaskan langsung, bukan semua perubahan project.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Low,
                        start: Some("2026-08-24"),
                        due: Some("2026-09-18"),
                        assignees: &[ARIF, SARI],
                        labels: &["frontend", "backend"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                ],
            },
            M {
                name: "Testing & Rilis",
                desc: "Diuji di kondisi nyata, bukan cuma di kantor dengan WiFi kencang.",
                tasks: &[
                    T {
                        title: "Uji perangkat: 6 model Android + 3 iPhone",
                        desc: "Termasuk perangkat kelas bawah dengan RAM 2GB — itu yang benar-benar dipakai sebagian tim lapangan.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::High,
                        start: Some("2026-11-09"),
                        due: Some("2026-11-26"),
                        assignees: &[ANISA],
                        labels: &["bug"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Unggah foto dengan kompresi & antrean"],
                    },
                    T {
                        title: "Uji lapangan di area sinyal buruk",
                        desc: "Bawa aplikasi ke tiga lokasi kerja dengan sinyal terburuk. Ini satu-satunya cara membuktikan mode offline benar-benar jalan.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-10-12"),
                        due: Some("2026-11-06"),
                        assignees: &[ANISA, RIZKY],
                        labels: &["urgent"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Mode offline dengan antrean sinkronisasi"],
                    },
                    T {
                        title: "Submit ke App Store & Play Store",
                        desc: "Siapkan screenshot, deskripsi, dan kebijakan privasi. Sisakan waktu dua minggu untuk proses review.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-11-27"),
                        due: Some("2026-12-15"),
                        assignees: &[RIZKY, ARIF],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Uji perangkat: 6 model Android + 3 iPhone", "Uji lapangan di area sinyal buruk"],
                    },
                ],
            },
        ],
        pages: &[
            (
                "Temuan Riset Lapangan",
                "🔍",
                "<h1>Temuan Riset Lapangan</h1><p>Tiga hari ikut tim teknisi di lapangan, Juni 2026.</p><h2>Yang mengejutkan</h2><p><strong>Sinyal hilang lebih sering dari dugaan.</strong> Di 3 dari 8 lokasi yang kami datangi, tidak ada data sama sekali selama 20–40 menit. Teknisi sudah terbiasa: mereka mencatat di kertas, lalu memasukkan ke portal saat kembali ke kantor. Kalau aplikasi tidak jalan offline, aplikasi ini tidak akan dipakai.</p><p><strong>HP dipakai sambil berdiri, satu tangan.</strong> Tangan satunya memegang alat. Semua aksi penting harus bisa dijangkau ibu jari.</p><p><strong>Layar sering dilihat di bawah matahari langsung.</strong> Kontras standar tidak terbaca. Perlu mode terang khusus.</p><h2>Implikasi desain</h2><ul><li><strong>Sinyal hilang 20–40 menit</strong> — Konsekuensi: Offline jadi syarat, bukan fitur tambahan</li><li><strong>Satu tangan, sambil berdiri</strong> — Konsekuensi: Aksi utama di zona ibu jari, target ≥ 48px</li><li><strong>Matahari langsung</strong> — Konsekuensi: Kontras dinaikkan, ikon diperbesar</li><li><strong>Kuota terbatas</strong> — Konsekuensi: Foto dikompresi sebelum diunggah</li></ul>",
                RIZKY,
            ),
            (
                "Lingkup MVP",
                "🎯",
                "<h1>Lingkup MVP</h1><h2>Masuk MVP</h2><ul><li>Login dengan nomor telepon + password</li><li>Daftar task yang ditugaskan ke saya</li><li>Ubah status task</li><li>Unggah foto bukti pekerjaan</li><li><strong>Mode offline penuh</strong> untuk semua di atas</li></ul><h2>Ditunda ke fase dua</h2><ul><li>Chat antar anggota tim</li><li>Laporan dan grafik</li><li>Membuat task baru dari HP</li><li>Melihat project orang lain</li></ul><h2>Alasan penundaan</h2><p>Tim lapangan tidak membuat task — mereka mengerjakannya. Fitur membuat task dari HP terdengar masuk akal di ruang rapat, tapi tidak satu pun teknisi yang kami temui memintanya.</p>",
                RIZKY,
            ),
        ],
        comments: &[
            ("Mode offline dengan antrean sinkronisasi", TEGUH, "<p>Resolusi konflik per field, bukan per record — kalau per record, teknisi yang mengubah status akan menimpa catatan yang diketik orang lain di menit yang sama.</p>", "2026-08-18T10:00:00Z"),
            ("Mode offline dengan antrean sinkronisasi", ARIF, "<p>Setuju. Berarti tiap field perlu timestamp sendiri di tabel lokal. Menambah kolom, tapi lebih murah daripada kehilangan data.</p>", "2026-08-18T13:25:00Z"),
            ("Daftar task saya & ubah status dari HP", RIZKY, "<p>Urutannya berdasarkan jatuh tempo ya, bukan tanggal dibuat. Teknisi peduli apa yang harus selesai hari ini.</p>", "2026-08-14T08:50:00Z"),
            ("Uji lapangan di area sinyal buruk", ANISA, "<p>Aku sudah minta daftar tiga lokasi dengan sinyal terburuk ke tim ops. Uji di kantor dengan WiFi dimatikan tidak cukup — kondisi sinyal lemah berbeda dari tanpa sinyal sama sekali.</p>", "2026-08-19T15:30:00Z"),
        ],
    },
    // ---------------------------------------------------------------- P4
    P {
        name: "Website Company Profile 2026",
        desc: "Perombakan website publik Sedjiwa: halaman layanan, portofolio, dan karier. Selesai dan tayang sejak April 2026.",
        owner: NADIA,
        status: ProjectStatus::Completed,
        start: "2026-01-05",
        end: "2026-04-17",
        members: &[NADIA, MAYA, RIZKY, TEGUH],
        modules: &[
            M {
                name: "Konten & Desain",
                desc: "",
                tasks: &[
                    T {
                        title: "Tulis ulang copy untuk seluruh halaman",
                        desc: "Copy lama penuh jargon dan tidak menjelaskan apa yang sebenarnya kami kerjakan.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-01-05"),
                        due: Some("2026-01-30"),
                        assignees: &[RIZKY],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Desain halaman beranda & layanan",
                        desc: "Satu pesan utama per layar, tanpa carousel.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-01-05"),
                        due: Some("2026-01-30"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Sesi foto tim & kantor",
                        desc: "Foto asli, bukan stock. Terbukti paling banyak dilihat di halaman Tentang Kami.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Low,
                        start: Some("2026-01-05"),
                        due: Some("2026-01-16"),
                        assignees: &[NADIA],
                        labels: &["design"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                ],
            },
            M {
                name: "Development",
                desc: "",
                tasks: &[
                    T {
                        title: "Implementasi halaman statis dengan Astro",
                        desc: "Statis dan cepat. Tidak ada alasan memakai SPA untuk company profile.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-02-02"),
                        due: Some("2026-02-27"),
                        assignees: &[MAYA],
                        labels: &["frontend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Desain halaman beranda & layanan"],
                    },
                    T {
                        title: "Halaman karier + form lamaran",
                        desc: "Form lamaran mengirim ke email HR dan menyimpan lampiran ke S3.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-01-05"),
                        due: Some("2026-01-23"),
                        assignees: &[MAYA],
                        labels: &["frontend", "feature"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Optimasi SEO & Core Web Vitals",
                        desc: "Meta tag, sitemap, structured data, dan target semua metrik Core Web Vitals di zona hijau.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-03-02"),
                        due: Some("2026-03-20"),
                        assignees: &[MAYA],
                        labels: &["enhancement"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Implementasi halaman statis dengan Astro"],
                    },
                ],
            },
            M {
                name: "Launch",
                desc: "",
                tasks: &[
                    T {
                        title: "Uji lintas browser & perangkat",
                        desc: "",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2026-03-23"),
                        due: Some("2026-03-27"),
                        assignees: &[MAYA, NADIA],
                        labels: &[],
                        subtasks: NO_SUBS,
                        blocked_by: &["Optimasi SEO & Core Web Vitals"],
                    },
                    T {
                        title: "Go-live & pantau 48 jam pertama",
                        desc: "Pindahkan DNS, pantau error dan trafik selama dua hari pertama.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-03-30"),
                        due: Some("2026-04-03"),
                        assignees: &[MAYA, TEGUH],
                        labels: &[],
                        subtasks: NO_SUBS,
                        blocked_by: &["Uji lintas browser & perangkat"],
                    },
                ],
            },
        ],
        pages: &[(
            "Laporan Penutupan Project",
            "✅",
            "<h1>Laporan Penutupan — Website Company Profile 2026</h1><p><strong>Status:</strong> Selesai, tayang 17 April 2026.</p><h2>Hasil</h2><ul><li><strong>LCP</strong> — Sebelum: 4,2 s · Sesudah: 1,1 s</li><li><strong>Bounce rate</strong> — Sebelum: 68% · Sesudah: 41%</li><li><strong>Lamaran masuk / bulan</strong> — Sebelum: 6 · Sesudah: 23</li></ul><h2>Yang berjalan baik</h2><ul><li>Menulis copy <strong>sebelum</strong> desain. Desain jadi menyesuaikan isi, bukan sebaliknya.</li><li>Memilih Astro. Tidak ada satu pun kebutuhan yang menuntut SPA.</li><li>Foto asli tim. Halaman Tentang Kami jadi halaman kedua paling banyak dilihat.</li></ul><h2>Yang perlu diperbaiki lain kali</h2><ul><li>Sesi foto molor dua minggu karena menunggu jadwal semua orang. Lain kali, foto bertahap saja.</li><li>SEO dikerjakan terlalu akhir. Beberapa keputusan struktur URL terpaksa diubah di menit terakhir.</li></ul>",
            NADIA,
        )],
        comments: &[
            ("Go-live & pantau 48 jam pertama", TEGUH, "<p>Trafik 48 jam pertama aman, tidak ada error 5xx. LCP di lapangan 1,1 detik — jauh di bawah target 2,5 detik.</p>", "2026-04-17T18:00:00Z"),
            ("Optimasi SEO & Core Web Vitals", MAYA, "<p>Semua metrik hijau. Yang paling berpengaruh ternyata bukan optimasi gambar, tapi menghapus font varian yang tidak terpakai.</p>", "2026-04-02T14:30:00Z"),
        ],
    },
    // ---------------------------------------------------------------- P5
    P {
        name: "Sistem Absensi & Payroll",
        desc: "Menggantikan absensi manual berbasis spreadsheet dengan sistem terintegrasi: absen berbasis lokasi, pengajuan cuti, dan perhitungan gaji otomatis.",
        owner: DEWI,
        status: ProjectStatus::Active,
        start: "2026-07-13",
        end: "2027-02-26",
        members: &[DEWI, SARI, MAYA, ANISA, TEGUH, YOGA],
        modules: &[
            M {
                name: "Requirement & Analisa",
                desc: "Aturan ketenagakerjaan tidak boleh ditebak.",
                tasks: &[
                    T {
                        title: "Kumpulkan aturan cuti, lembur, dan potongan dari HR",
                        desc: "Termasuk kasus-kasus khusus yang selama ini ditangani manual: cuti setengah hari, lembur hari libur, dan potongan keterlambatan bertingkat.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-07-13"),
                        due: Some("2026-07-31"),
                        assignees: &[DEWI],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Petakan alur persetujuan cuti per level jabatan",
                        desc: "Staf ke manajer, manajer ke direktur. Cuti lebih dari lima hari selalu butuh persetujuan direktur.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2026-08-03"),
                        due: Some("2026-08-18"),
                        assignees: &[DEWI, TEGUH],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Kumpulkan aturan cuti, lembur, dan potongan dari HR"],
                    },
                    T {
                        title: "Validasi rumus payroll dengan data 3 bulan terakhir",
                        desc: "Jalankan rumus baru terhadap data gaji tiga bulan yang sudah dibayarkan. Selisih nol rupiah adalah syarat sebelum lanjut.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-08-19"),
                        due: Some("2026-08-23"),
                        assignees: &[DEWI, SARI],
                        labels: &["urgent"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Petakan alur persetujuan cuti per level jabatan"],
                    },
                ],
            },
            M {
                name: "Modul Absensi",
                desc: "",
                tasks: &[
                    T {
                        title: "Absen masuk/pulang berbasis lokasi",
                        desc: "Geofence radius 100 meter dari titik kantor. Absen di luar radius tetap tercatat tapi ditandai untuk ditinjau.",
                        status: TaskStatus::InProgress,
                        prio: TaskPriority::High,
                        start: Some("2026-08-12"),
                        due: Some("2026-08-24"),
                        assignees: &[SARI, MAYA],
                        labels: &["feature", "backend"],
                        subtasks: &[
                            ("Validasi geofence di sisi server", TaskStatus::Done, &[SARI]),
                            ("Layar absen di web & mobile", TaskStatus::InProgress, &[MAYA]),
                            ("Tandai absen di luar radius", TaskStatus::Todo, &[SARI]),
                        ],
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Pengajuan & persetujuan cuti",
                        desc: "Form pengajuan, notifikasi ke atasan, dan riwayat sisa cuti per karyawan.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::High,
                        start: Some("2026-08-24"),
                        due: Some("2026-09-18"),
                        assignees: &[MAYA, SARI],
                        labels: &["feature"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Petakan alur persetujuan cuti per level jabatan"],
                    },
                    T {
                        title: "Laporan kehadiran bulanan untuk HR",
                        desc: "Ekspor ke Excel dengan format yang sudah dipakai HR sekarang, supaya tidak perlu ubah kebiasaan.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-08-25"),
                        due: Some("2026-09-12"),
                        assignees: &[MAYA],
                        labels: &["feature"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Absen masuk/pulang berbasis lokasi"],
                    },
                ],
            },
            M {
                name: "Modul Payroll",
                desc: "Bagian yang tidak boleh salah satu rupiah pun.",
                tasks: &[
                    T {
                        title: "Mesin perhitungan gaji (gaji pokok, lembur, potongan)",
                        desc: "Perhitungan ditulis sebagai fungsi murni dengan tes unit lengkap. Setiap aturan dari HR jadi satu kasus uji.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-08-24"),
                        due: Some("2026-10-02"),
                        assignees: &[SARI],
                        labels: &["backend", "feature"],
                        subtasks: &[
                            ("Perhitungan gaji pokok & tunjangan", TaskStatus::Todo, &[SARI]),
                            ("Perhitungan lembur (biasa & hari libur)", TaskStatus::Todo, &[SARI]),
                            ("Potongan keterlambatan bertingkat", TaskStatus::Todo, &[SARI]),
                            ("Potongan BPJS & PPh 21", TaskStatus::Todo, &[SARI, DEWI]),
                        ],
                        blocked_by: &["Validasi rumus payroll dengan data 3 bulan terakhir"],
                    },
                    T {
                        title: "Generate slip gaji PDF",
                        desc: "Slip per karyawan, dikirim otomatis lewat email pada tanggal penggajian.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-10-05"),
                        due: Some("2026-10-30"),
                        assignees: &[MAYA],
                        labels: &["feature"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Mesin perhitungan gaji (gaji pokok, lembur, potongan)"],
                    },
                ],
            },
            M {
                name: "Integrasi & QA",
                desc: "",
                tasks: &[
                    T {
                        title: "Uji paralel: sistem baru vs perhitungan manual HR",
                        desc: "Jalankan dua bulan berdampingan. Sistem baru baru dipakai resmi setelah dua siklus tanpa selisih.",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Urgent,
                        start: Some("2026-11-02"),
                        due: Some("2026-12-18"),
                        assignees: &[ANISA, DEWI],
                        labels: &["urgent"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Generate slip gaji PDF"],
                    },
                    T {
                        title: "Pelatihan HR & serah terima dokumentasi",
                        desc: "",
                        status: TaskStatus::Todo,
                        prio: TaskPriority::Medium,
                        start: Some("2026-12-21"),
                        due: Some("2027-01-15"),
                        assignees: &[DEWI],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Uji paralel: sistem baru vs perhitungan manual HR"],
                    },
                ],
            },
        ],
        pages: &[(
            "Aturan Payroll",
            "💰",
            "<h1>Aturan Payroll</h1><p>Dikumpulkan dari HR, Juli 2026. <strong>Setiap aturan di sini harus punya tes unit yang sesuai.</strong></p><h2>Lembur</h2><ul><li><strong>Hari kerja, jam ke-1</strong> — Pengali: 1,5×</li><li><strong>Hari kerja, jam ke-2 dst</strong> — Pengali: 2×</li><li><strong>Hari libur, jam ke-1–8</strong> — Pengali: 2×</li><li><strong>Hari libur, jam ke-9 dst</strong> — Pengali: 3×</li></ul><h2>Potongan keterlambatan</h2><p>Bertingkat, dihitung per kejadian dalam satu bulan:</p><ul><li>Terlambat 1–3 kali: tanpa potongan (peringatan lisan)</li><li>Terlambat 4–6 kali: potongan 2% gaji pokok</li><li>Terlambat lebih dari 6 kali: potongan 5% gaji pokok</li></ul><h2>Cuti</h2><ul><li>Jatah tahunan 12 hari, hangus akhir tahun (tidak bisa diuangkan).</li><li>Cuti setengah hari dihitung 0,5 dari jatah.</li><li>Cuti lebih dari 5 hari berturut-turut wajib disetujui direktur.</li></ul><h2>Catatan penting</h2><p>Pembulatan selalu <strong>ke bawah</strong> ke rupiah terdekat, mengikuti praktik HR sekarang. Ini terlihat sepele, tapi selisih pembulatan adalah penyebab paling sering ketidakcocokan saat rekonsiliasi.</p>",
            DEWI,
        )],
        comments: &[
            ("Validasi rumus payroll dengan data 3 bulan terakhir", DEWI, "<p>Sudah jalan untuk Mei dan Juni: selisih nol. Juli masih ada beda Rp 1.200 di dua karyawan — dugaanku soal pembulatan lembur.</p>", "2026-08-19T11:20:00Z"),
            ("Validasi rumus payroll dengan data 3 bulan terakhir", SARI, "<p>Betul, pembulatannya. Aku membulatkan per komponen, HR membulatkan di total akhir. Sudah kuubah mengikuti HR.</p>", "2026-08-19T13:55:00Z"),
            ("Mesin perhitungan gaji (gaji pokok, lembur, potongan)", TEGUH, "<p>Tulis ini sebagai fungsi murni tanpa akses database. Semua input masuk sebagai argumen. Bagian ini harus bisa diuji tanpa menyiapkan satu baris data pun.</p>", "2026-08-18T09:30:00Z"),
            ("Absen masuk/pulang berbasis lokasi", ANISA, "<p>Pertanyaan: kalau GPS karyawan mati atau tidak akurat, apa yang terjadi? Jangan sampai orang tidak bisa absen sama sekali gara-gara sinyal GPS.</p>", "2026-08-20T08:15:00Z"),
        ],
    },
    // ---------------------------------------------------------------- P6
    P {
        name: "Integrasi Payment Gateway",
        desc: "Integrasi Midtrans dan Xendit untuk pembayaran invoice klien. Diarsipkan — kebutuhan berubah dan digabung ke project Sales Portal.",
        owner: SARI,
        status: ProjectStatus::Archived,
        start: "2025-09-01",
        end: "2025-12-19",
        members: &[SARI, FAJAR, TEGUH],
        modules: &[
            M {
                name: "Integrasi",
                desc: "",
                tasks: &[
                    T {
                        title: "Riset dan bandingkan Midtrans vs Xendit",
                        desc: "Bandingkan biaya per transaksi, metode pembayaran yang didukung, dan kualitas dokumentasi.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2025-09-01"),
                        due: Some("2025-09-19"),
                        assignees: &[SARI],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Implementasi pembayaran virtual account",
                        desc: "",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2025-09-22"),
                        due: Some("2025-10-17"),
                        assignees: &[SARI],
                        labels: &["backend", "feature"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Riset dan bandingkan Midtrans vs Xendit"],
                    },
                    T {
                        title: "Webhook konfirmasi pembayaran",
                        desc: "Verifikasi tanda tangan, dan tangani pengiriman ganda — gateway bisa mengirim webhook yang sama lebih dari sekali.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Urgent,
                        start: Some("2025-10-20"),
                        due: Some("2025-11-14"),
                        assignees: &[FAJAR],
                        labels: &["backend"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Implementasi pembayaran virtual account"],
                    },
                ],
            },
            M {
                name: "Testing & Go-Live",
                desc: "",
                tasks: &[
                    T {
                        title: "Uji end-to-end di lingkungan sandbox",
                        desc: "",
                        status: TaskStatus::Done,
                        prio: TaskPriority::High,
                        start: Some("2025-11-17"),
                        due: Some("2025-12-05"),
                        assignees: &[SARI, FAJAR],
                        labels: &[],
                        subtasks: NO_SUBS,
                        blocked_by: &["Webhook konfirmasi pembayaran"],
                    },
                    T {
                        title: "Integrasi e-wallet (GoPay, OVO, Dana)",
                        desc: "Dibatalkan: kebutuhan dipindahkan ke project Sales Portal yang menangani seluruh alur invoice.",
                        status: TaskStatus::Cancelled,
                        prio: TaskPriority::Medium,
                        start: Some("2025-09-01"),
                        due: Some("2025-09-12"),
                        assignees: &[SARI],
                        labels: &["feature"],
                        subtasks: NO_SUBS,
                        blocked_by: NO_DEPS,
                    },
                    T {
                        title: "Dokumentasi serah terima ke tim Sales Portal",
                        desc: "Catatan integrasi, kredensial sandbox, dan hal-hal yang sudah terbukti bermasalah.",
                        status: TaskStatus::Done,
                        prio: TaskPriority::Medium,
                        start: Some("2025-12-08"),
                        due: Some("2025-12-19"),
                        assignees: &[SARI, TEGUH],
                        labels: &["docs"],
                        subtasks: NO_SUBS,
                        blocked_by: &["Uji end-to-end di lingkungan sandbox"],
                    },
                ],
            },
        ],
        pages: &[(
            "Catatan Penutupan",
            "📦",
            "<h1>Catatan Penutupan — Integrasi Payment Gateway</h1><p><strong>Status:</strong> Diarsipkan, Desember 2025.</p><h2>Kenapa diarsipkan</h2><p>Kebutuhan pembayaran ternyata tidak berdiri sendiri — ia bagian dari alur invoice yang seluruhnya ada di Sales Portal. Memisahkannya jadi project sendiri membuat dua tim menyentuh alur yang sama.</p><h2>Yang sudah jadi dan diserahkan</h2><ul><li>Pembayaran virtual account (Midtrans), sudah teruji di sandbox.</li><li>Webhook konfirmasi dengan verifikasi tanda tangan dan penanganan pengiriman ganda.</li><li>Kredensial sandbox dan catatan integrasi.</li></ul><h2>Pelajaran</h2><p>Webhook gateway <strong>akan</strong> dikirim lebih dari sekali. Kami menemukannya di sandbox, bukan di produksi — itu keberuntungan, bukan hasil perencanaan. Lain kali, idempotensi ditulis sejak awal, bukan setelah ada webhook ganda yang terlihat di log.</p>",
            SARI,
        )],
        comments: &[
            ("Webhook konfirmasi pembayaran", FAJAR, "<p>Gateway mengirim webhook yang sama tiga kali untuk satu transaksi di sandbox. Sudah kutambahkan tabel idempotensi berdasarkan id transaksi.</p>", "2025-11-10T10:40:00Z"),
            ("Integrasi e-wallet (GoPay, OVO, Dana)", TEGUH, "<p>Dibatalkan. Seluruh alur invoice dipindah ke Sales Portal — tidak masuk akal menyelesaikan ini di sini.</p>", "2025-12-08T09:00:00Z"),
        ],
    },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

fn ts(date: &str, time: &str) -> String {
    format!("{date}T{time}Z")
}

/// The instant this dataset is written from. Task windows are laid out around
/// it so finished work sits in the past and planned work in the future.
const TODAY: &str = "2026-08-20";

/// When a task was *created*, as opposed to when it is scheduled to start.
/// Planning happens before the work does, and it can never happen in the
/// future — so this walks back from the earlier of (start, today) by `lead`
/// days, which keeps the activity feed reading as history rather than
/// prophecy.
/// Shift an ISO `yyyy-MM-dd` date by `n` days (negative shifts backwards).
fn add_days(date: &str, n: i64) -> String {
    use time::{macros::format_description, Date, Duration};
    let fmt = format_description!("[year]-[month]-[day]");
    match Date::parse(date, fmt) {
        Ok(d) => (d + Duration::days(n))
            .format(fmt)
            .unwrap_or_else(|_| date.to_string()),
        Err(_) => date.to_string(),
    }
}

/// ISO dates sort lexicographically, so chronological min/max are plain
/// string comparisons.
fn min_date(a: &str, b: &str) -> String {
    if a <= b { a.into() } else { b.into() }
}
fn max_date(a: &str, b: &str) -> String {
    if a >= b { a.into() } else { b.into() }
}

/// A subtask's own window, carved out of its parent's. Inheriting the parent
/// window verbatim would put a finished subtask's due date in the future
/// whenever the parent is still running, so each status gets placed against
/// today: done work ends before it, running work straddles it, planned work
/// starts after it.
fn subtask_window(
    parent_start: &str,
    parent_due: &str,
    status: TaskStatus,
) -> (String, String) {
    let (start, due) = match status {
        TaskStatus::Done => (
            parent_start.to_string(),
            min_date(parent_due, &add_days(TODAY, -2)),
        ),
        TaskStatus::InProgress => (
            min_date(parent_start, &add_days(TODAY, -3)),
            max_date(parent_due, &add_days(TODAY, 2)),
        ),
        _ => (
            max_date(parent_start, &add_days(TODAY, 1)),
            max_date(parent_due, &add_days(TODAY, 6)),
        ),
    };
    if start > due {
        let due = add_days(&start, 3);
        return (start, due);
    }
    (start, due)
}

fn created_on(start: &str, lead: i64) -> String {
    use time::{macros::format_description, Date, Duration};
    let fmt = format_description!("[year]-[month]-[day]");
    let Ok(s) = Date::parse(start, fmt) else {
        return ts(start, "09:00:00");
    };
    let today = Date::parse(TODAY, fmt).expect("TODAY is a valid date");
    let base = if s < today { s } else { today };
    let d = base - Duration::days(lead);
    ts(&d.format(fmt).unwrap_or_else(|_| start.to_string()), "09:00:00")
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let database_url = std::env::var("DATABASE_URL").map_err(|_| anyhow!("DATABASE_URL not set"))?;
    let store = Store::connect(&database_url, domain::register_all).await?;

    // This seed is not idempotent — every run creates a fresh set of entities,
    // so a second run silently doubles the dataset instead of failing. Refuse
    // to start on a database that already holds users or projects.
    let users = store.count::<UserPhone>(None).await?;
    let projects = store.count::<ProjectName>(None).await?;
    if users > 0 || projects > 0 {
        if std::env::var("SEED_DEMO_FORCE").is_err() {
            return Err(anyhow!(
                "database is not empty ({users} users, {projects} projects) and this seed is \
                 not idempotent — running it again would duplicate the dataset.\n\n\
                 Wipe first:\n  \
                 psql \"$DATABASE_URL\" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'\n\n\
                 Or set SEED_DEMO_FORCE=1 to append anyway."
            ));
        }
        eprintln!(
            "seed_demo: SEED_DEMO_FORCE set — appending to a non-empty database \
             ({users} users, {projects} projects)"
        );
    }

    // Argon2 is deliberately slow; hash each distinct password once and reuse.
    let admin_hash = hash_password("admin12345").map_err(|e| anyhow!(e.to_string()))?;
    let demo_hash = hash_password("demo12345").map_err(|e| anyhow!(e.to_string()))?;

    // ---- Users -----------------------------------------------------------
    let mut user_pids: Vec<i64> = Vec::with_capacity(USERS.len());
    for (phone, name, email, status, is_admin) in USERS {
        let created = ts("2026-01-06", "08:00:00");
        let pid = store
            .create((
                UserPhone {
                    value: (*phone).into(),
                    verified: true,
                },
                UserPassword {
                    hash: if *is_admin {
                        admin_hash.clone()
                    } else {
                        demo_hash.clone()
                    },
                    changed_at: created.clone(),
                },
                UserProfile {
                    display_name: (*name).into(),
                    avatar_url: String::new(),
                    email: (*email).into(),
                },
                UserStatusComponent {
                    status: status.as_str().to_string(),
                    created_at: created.clone(),
                    last_login_at: Some(ts("2026-08-20", "07:42:00")),
                },
            ))
            .await?;
        if *is_admin {
            let granted = created.clone();
            store
                .update(pid, move |w, e| {
                    w.insert(e, AdminMark { granted_at: granted });
                })
                .await?;
        }
        user_pids.push(pid);
    }
    println!("seed_demo: {} users", user_pids.len());

    let uid = |i: usize| user_pids[i].to_string();
    let uids = |xs: &[usize]| xs.iter().map(|i| uid(*i)).collect::<Vec<_>>();

    let mut n_projects = 0usize;
    let mut n_modules = 0usize;
    let mut n_tasks = 0usize;
    let mut n_subtasks = 0usize;
    let mut n_labels = 0usize;
    let mut n_comments = 0usize;
    let mut n_pages = 0usize;
    let mut n_activity = 0usize;
    let mut n_notifs = 0usize;

    for p in PROJECTS {
        // ---- Project ------------------------------------------------------
        let project_pid = store
            .create((
                ProjectName {
                    value: p.name.into(),
                },
                ProjectDescription {
                    value: p.desc.into(),
                },
                ProjectOwnerId { value: uid(p.owner) },
                ProjectStatusComponent {
                    value: p.status.as_str().to_string(),
                },
                ProjectDates {
                    start_date: Some(p.start.into()),
                    end_date: Some(p.end.into()),
                },
            ))
            .await?;
        let project_id = project_pid.to_string();
        n_projects += 1;

        // ---- Membership ---------------------------------------------------
        for m in p.members {
            store
                .create((ProjectMembership {
                    project_id: project_id.clone(),
                    user_id: uid(*m),
                },))
                .await?;
        }

        // ---- Labels -------------------------------------------------------
        let mut label_ids: HashMap<&str, String> = HashMap::new();
        for (name, color) in LABELS {
            let pid = store
                .create((LabelInfo {
                    project_id: project_id.clone(),
                    name: (*name).into(),
                    color: (*color).into(),
                },))
                .await?;
            label_ids.insert(name, pid.to_string());
            n_labels += 1;
        }

        // ---- Modules & tasks ----------------------------------------------
        // Title → pid, so `blocked_by` (written as titles) can be resolved
        // after every task in the project exists.
        let mut task_ids: HashMap<&str, i64> = HashMap::new();

        for (mi, m) in p.modules.iter().enumerate() {
            let module_pid = store
                .create((
                    ModuleName { value: m.name.into() },
                    ModuleProjectRef {
                        project_id: project_id.clone(),
                    },
                    ModuleOrder { value: mi as i32 },
                ))
                .await?;
            if !m.desc.is_empty() {
                let d = m.desc.to_string();
                store
                    .update(module_pid, move |w, e| {
                        w.insert(e, ModuleDescription { value: d });
                    })
                    .await?;
            }
            let module_id = module_pid.to_string();
            n_modules += 1;

            for (ti, t) in m.tasks.iter().enumerate() {
                let created_at = created_on(t.start.unwrap_or(p.start), 7 + (ti as i64 * 2));
                let updated_at = ts(t.due.unwrap_or(p.end), "17:00:00");
                let completed_at = matches!(t.status, TaskStatus::Done)
                    .then(|| ts(t.due.unwrap_or(p.end), "16:30:00"));

                let task_pid = store
                    .create((
                        TaskInfo {
                            title: t.title.into(),
                            description: t.desc.into(),
                            status: t.status.as_str().to_string(),
                            priority: t.prio.as_str().to_string(),
                            start_date: t.start.map(str::to_string),
                            due_date: t.due.map(str::to_string),
                            sort_order: ti as i32,
                        },
                        TaskModuleRef {
                            module_id: module_id.clone(),
                        },
                        TaskAssignees {
                            user_ids: uids(t.assignees),
                        },
                        TaskLabels {
                            label_ids: t
                                .labels
                                .iter()
                                .filter_map(|l| label_ids.get(l).cloned())
                                .collect(),
                        },
                        TaskAudit {
                            created_at: created_at.clone(),
                            updated_at,
                            completed_at,
                            created_by: uid(p.owner),
                        },
                    ))
                    .await?;
                task_ids.insert(t.title, task_pid);
                n_tasks += 1;

                // ---- Subtasks (exactly one level) -------------------------
                for (si, (sub_title, sub_status, sub_assignees)) in t.subtasks.iter().enumerate() {
                    let (sub_start, sub_due) = subtask_window(
                        t.start.unwrap_or(p.start),
                        t.due.unwrap_or(p.end),
                        *sub_status,
                    );
                    let sub_completed = matches!(sub_status, TaskStatus::Done)
                        .then(|| ts(&sub_due, "15:00:00"));
                    let sub_pid = store
                        .create((
                            TaskInfo {
                                title: (*sub_title).into(),
                                description: String::new(),
                                status: sub_status.as_str().to_string(),
                                priority: TaskPriority::None.as_str().to_string(),
                                start_date: Some(sub_start.clone()),
                                due_date: Some(sub_due.clone()),
                                sort_order: si as i32,
                            },
                            TaskModuleRef {
                                module_id: module_id.clone(),
                            },
                            TaskParent {
                                parent_id: task_pid.to_string(),
                            },
                            TaskAssignees {
                                user_ids: uids(sub_assignees),
                            },
                            TaskAudit {
                                created_at: created_at.clone(),
                                updated_at: created_at.clone(),
                                completed_at: sub_completed,
                                created_by: uid(p.owner),
                            },
                        ))
                        .await?;
                    let _ = sub_pid;
                    n_subtasks += 1;
                }

                // ---- Activity: task created -------------------------------
                store
                    .create((ActivityInfo {
                        project_id: project_id.clone(),
                        actor_id: uid(p.owner),
                        entity_type: EntityType::Task.as_str().to_string(),
                        entity_id: task_pid.to_string(),
                        action: ActivityAction::Created.as_str().to_string(),
                        summary: format!("membuat task \"{}\"", t.title),
                        created_at: created_at.clone(),
                    },))
                    .await?;
                n_activity += 1;

                // ---- Notifications: assignment ----------------------------
                for a in t.assignees {
                    if *a == p.owner {
                        continue;
                    }
                    let notif_pid = store
                        .create((NotificationInfo {
                            recipient_id: uid(*a),
                            kind: NotificationType::TaskAssigned.as_str().to_string(),
                            actor_id: uid(p.owner),
                            message: format!(
                                "{} menugaskan \"{}\" ke kamu",
                                USERS[p.owner].1, t.title
                            ),
                            // Only work still in flight stays unread.
                            read: !matches!(t.status, TaskStatus::InProgress),
                            created_at: created_at.clone(),
                        },))
                        .await?;
                    let (pid_ref, task_ref) = (project_id.clone(), task_pid.to_string());
                    store
                        .update(notif_pid, move |w, e| {
                            w.insert(
                                e,
                                NotificationRefs {
                                    project_id: Some(pid_ref),
                                    task_id: Some(task_ref),
                                    comment_id: None,
                                },
                            );
                        })
                        .await?;
                    n_notifs += 1;
                }
            }
        }

        // ---- Dependencies (second pass: titles are now resolvable) ---------
        for m in p.modules {
            for t in m.tasks {
                if t.blocked_by.is_empty() {
                    continue;
                }
                let Some(task_pid) = task_ids.get(t.title).copied() else {
                    continue;
                };
                let deps: Vec<String> = t
                    .blocked_by
                    .iter()
                    .filter_map(|title| {
                        let found = task_ids.get(title).copied();
                        if found.is_none() {
                            eprintln!(
                                "seed_demo: WARNING dependency \"{title}\" not found in project \"{}\"",
                                p.name
                            );
                        }
                        found
                    })
                    .map(|pid| pid.to_string())
                    .collect();
                store
                    .update(task_pid, move |w, e| {
                        w.insert(e, TaskBlockedBy { task_ids: deps });
                    })
                    .await?;
            }
        }

        // ---- Comments -----------------------------------------------------
        for (task_title, author, content, created_at) in p.comments {
            let Some(task_pid) = task_ids.get(task_title).copied() else {
                eprintln!(
                    "seed_demo: WARNING comment target \"{task_title}\" not found in project \"{}\"",
                    p.name
                );
                continue;
            };
            store
                .create((CommentInfo {
                    task_id: task_pid.to_string(),
                    author_id: uid(*author),
                    content: (*content).into(),
                    mentioned_user_ids: vec![],
                    created_at: (*created_at).into(),
                    updated_at: (*created_at).into(),
                },))
                .await?;
            n_comments += 1;
        }

        // ---- Pages --------------------------------------------------------
        for (pi, (title, icon, content, author)) in p.pages.iter().enumerate() {
            let page_pid = store
                .create((PageInfo {
                    project_id: project_id.clone(),
                    title: (*title).into(),
                    icon: (*icon).into(),
                    content: (*content).into(),
                    sort_order: pi as i32,
                },))
                .await?;
            let (created_by, edited_by) = (uid(*author), uid(*author));
            store
                .update(page_pid, move |w, e| {
                    w.insert(
                        e,
                        PageAudit {
                            created_by,
                            last_edited_by: edited_by,
                            created_at: ts("2026-08-03", "10:00:00"),
                            updated_at: ts("2026-08-19", "16:20:00"),
                        },
                    );
                })
                .await?;
            n_pages += 1;
        }

        // ---- Activity: project created -------------------------------------
        store
            .create((ActivityInfo {
                project_id: project_id.clone(),
                actor_id: uid(p.owner),
                entity_type: EntityType::Ownership.as_str().to_string(),
                entity_id: project_id.clone(),
                action: ActivityAction::Created.as_str().to_string(),
                summary: format!("membuat project \"{}\"", p.name),
                created_at: ts(p.start, "08:30:00"),
            },))
            .await?;
        n_activity += 1;

        println!("seed_demo: project \"{}\" (pid {project_pid})", p.name);
    }

    println!(
        "\nseed_demo: done — {} users, {n_projects} projects, {n_modules} modules, \
         {n_tasks} tasks (+{n_subtasks} subtasks), {n_labels} labels, {n_comments} comments, \
         {n_pages} pages, {n_activity} activity, {n_notifs} notifications",
        user_pids.len()
    );
    println!("seed_demo: login admin 0800000000 / admin12345 — anggota tim <phone> / demo12345");
    println!("seed_demo: run `cargo run --bin reindex` to populate search_doc");
    Ok(())
}
