#!/usr/bin/env bun
/**
 * Seed a generous amount of realistic dummy data into the running backend-rs,
 * through the real Connect API (so activity + notifications fire naturally).
 *
 * Usage:  bun deploy/seed-dummy.ts            (defaults to http://localhost:3010)
 *         API=http://localhost:3011/api/tasks-rs bun deploy/seed-dummy.ts
 *
 * Idempotent-ish: users get a random phone suffix each run, so re-running just
 * ADDS more data rather than colliding on unique phones.
 */

const API = (process.env.API ?? "http://localhost:3010").replace(/\/$/, "");
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? "0800000000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin12345";

let token = "";

async function rpc<T = any>(fq: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${fq}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${fq} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ── helpers ──────────────────────────────────────────────────────────────
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[rnd(a.length)];
const sample = <T>(a: T[], k: number): T[] => {
  const c = [...a];
  for (let i = c.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.slice(0, Math.min(k, c.length));
};
const daysFromNow = (d: number) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(9, 0, 0, 0);
  return t.toISOString();
};

// ── sample content ───────────────────────────────────────────────────────
const FIRST = ["Andi", "Budi", "Citra", "Dewi", "Eka", "Fajar", "Gita", "Hadi",
  "Indah", "Joko", "Kirana", "Lukman", "Maya", "Nanda", "Oki", "Putri", "Rizki", "Sari"];
const LAST = ["Wijaya", "Santoso", "Pratama", "Nugroho", "Halim", "Kusuma",
  "Saputra", "Utami", "Permana", "Anggraini", "Firmansyah", "Lestari"];

const PROJECTS = [
  { name: "Sedjiwa Core Platform", description: "Portal inti: auth, RBAC, dan integrasi lintas layanan." },
  { name: "Mobile App Revamp", description: "Rewrite aplikasi mobile dengan arsitektur baru." },
  { name: "Billing & Invoicing", description: "Sistem penagihan, langganan, dan faktur otomatis." },
  { name: "Data Warehouse", description: "Pipeline ETL dan dashboard analitik internal." },
  { name: "Customer Support Portal", description: "Helpdesk, tiket, dan basis pengetahuan pelanggan." },
  { name: "Marketing Website", description: "Landing pages, blog, dan optimasi SEO." },
];

const LABELS = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#3b82f6" },
  { name: "Enhancement", color: "#8b5cf6" },
  { name: "Documentation", color: "#10b981" },
  { name: "Urgent", color: "#f59e0b" },
  { name: "Tech Debt", color: "#6b7280" },
];

const MODULES = ["Backlog", "Sprint Aktif", "In Review", "Selesai"];

const TASK_TITLES = [
  "Setup CI/CD pipeline", "Perbaiki bug login redirect", "Desain skema database",
  "Implementasi endpoint autentikasi", "Migrasi data lama", "Tulis unit test service",
  "Integrasi payment gateway", "Optimasi query lambat", "Refactor modul notifikasi",
  "Buat komponen date picker", "Tambah rate limiting", "Audit keamanan dependency",
  "Dokumentasi API publik", "Perbaiki layout mobile", "Implementasi dark mode",
  "Caching response endpoint", "Setup monitoring & alert", "Buat halaman dashboard",
  "Validasi form registrasi", "Handle error boundary", "Ekspor laporan ke PDF",
  "Implementasi search global", "Perbaiki timezone bug", "Upgrade versi framework",
];

const STATUSES = ["TODO", "TODO", "IN_PROGRESS", "IN_PROGRESS", "DONE", "CANCELLED"];
const PRIORITIES = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "URGENT", "NONE"];

const COMMENTS = [
  "Sudah aku cek, ini karena race condition di reconnect.",
  "Bisa tolong review PR-nya hari ini?", "Menurutku pendekatan ini lebih clean.",
  "Ada blocker di sisi backend, nunggu API ready.", "Sudah selesai, tinggal QA.",
  "Kayaknya perlu diskusi dulu di standup besok.", "Nice, works on my machine 😄",
  "Jangan lupa update dokumentasinya ya.", "Estimasi mundur 1 hari, ada dependency.",
  "LGTM 👍", "Ini duplikat dari task sebelumnya?", "Tolong tambahkan test case-nya.",
];

const PAGES = [
  { title: "Project Overview", icon: "📋", content: "# Overview\n\nTujuan, ruang lingkup, dan milestone utama proyek ini.\n\n## Goals\n- Kirim MVP di Q3\n- Coverage test > 80%\n" },
  { title: "Technical Spec", icon: "⚙️", content: "# Technical Specification\n\n## Arsitektur\nBackend Rust + Connect, frontend React.\n\n## Data Model\nDetail entitas dan relasi.\n" },
  { title: "Meeting Notes", icon: "📝", content: "# Meeting Notes\n\n## Standup\n- Progress task minggu ini\n- Blocker & action items\n" },
];

// ── seed ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding via ${API} …`);

  const login = await rpc<{ token: string }>(
    "sedjiwa.tasks.auth.v1.AuthService/Login",
    { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
  );
  token = login.token;
  console.log("✔ logged in as admin");

  // Users (Active) via admin CreateUser
  const suffix = Date.now().toString().slice(-6);
  const NUM_USERS = 14;
  const users: { id: string; name: string }[] = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const phone = `08${suffix}${String(i).padStart(2, "0")}`;
    const u = await rpc<{ id: string }>(
      "sedjiwa.tasks.auth.v1.UserDirectoryService/CreateUser",
      { phone, password: "password123", display_name: name, is_admin: false },
    );
    users.push({ id: u.id, name });
  }
  console.log(`✔ created ${users.length} users`);

  let taskCount = 0, commentCount = 0, labelCount = 0, moduleCount = 0, pageCount = 0, memberCount = 0;

  for (const p of PROJECTS) {
    const owner = pick(users);
    const project = await rpc<{ id: string }>(
      "sedjiwa.tasks.project.v1.ProjectService/CreateProject",
      { name: p.name, description: p.description, owner_id: owner.id },
    );
    const pid = project.id;

    // Members (subset of users, excluding owner)
    const members = sample(users.filter((u) => u.id !== owner.id), 4 + rnd(4));
    for (const m of members) {
      await rpc("sedjiwa.tasks.project.v1.ProjectService/AddProjectMember",
        { project_id: pid, user_id: m.id });
      memberCount++;
    }
    const projectPeople = [owner, ...members];

    // Labels
    const labels: string[] = [];
    for (const l of sample(LABELS, 5)) {
      const lab = await rpc<{ id: string }>(
        "sedjiwa.tasks.label.v1.LabelService/CreateLabel",
        { project_id: pid, name: l.name, color: l.color },
      );
      labels.push(lab.id);
      labelCount++;
    }

    // Modules + tasks
    for (const mName of MODULES) {
      const mod = await rpc<{ id: string }>(
        "sedjiwa.tasks.work.v1.ModuleService/CreateModule",
        { project_id: pid, name: mName },
      );
      moduleCount++;

      const nTasks = 3 + rnd(4); // 3..6 per module
      for (let t = 0; t < nTasks; t++) {
        const status = pick(STATUSES);
        const hasDates = Math.random() < 0.7;
        const startOffset = -10 + rnd(20);            // -10..9 days from now
        const dueOffset = startOffset + 1 + rnd(20);  // always strictly after start
        const task = await rpc<{ id: string }>(
          "sedjiwa.tasks.work.v1.TaskService/CreateTask",
          {
            module_id: mod.id,
            title: pick(TASK_TITLES),
            description: Math.random() < 0.6 ? "Detail dan acceptance criteria menyusul." : undefined,
            status,
            priority: pick(PRIORITIES),
            start_date: hasDates ? daysFromNow(startOffset) : undefined,
            due_date: hasDates ? daysFromNow(dueOffset) : undefined,
            assignee_ids: sample(projectPeople, 1 + rnd(2)).map((u) => u.id),
            label_ids: Math.random() < 0.7 ? sample(labels, 1 + rnd(2)) : [],
          },
        );
        taskCount++;

        // Comments on ~45% of tasks (authored by admin; require_member bypasses
        // for admin, and comment notifications still fire to task assignees).
        if (Math.random() < 0.45) {
          const nc = 1 + rnd(3);
          for (let c = 0; c < nc; c++) {
            await rpc("sedjiwa.tasks.comment.v1.CommentService/CreateComment",
              { task_id: task.id, content: pick(COMMENTS), mentioned_user_ids: [] });
            commentCount++;
          }
        }
      }
    }

    // Pages
    for (const pg of PAGES) {
      await rpc("sedjiwa.tasks.page.v1.PageService/CreatePage",
        { project_id: pid, title: pg.title, icon: pg.icon, content: pg.content });
      pageCount++;
    }

    console.log(`✔ project "${p.name}": ${members.length} members, tasks so far ${taskCount}`);
  }

  console.log("\n─── Seed complete ───");
  console.log(`users:    ${users.length}`);
  console.log(`projects: ${PROJECTS.length}`);
  console.log(`members:  ${memberCount}`);
  console.log(`labels:   ${labelCount}`);
  console.log(`modules:  ${moduleCount}`);
  console.log(`tasks:    ${taskCount}`);
  console.log(`comments: ${commentCount}`);
  console.log(`pages:    ${pageCount}`);
}

main().catch((e) => {
  console.error("\n✖ Seed failed:", e.message);
  process.exit(1);
});
