import { Link } from "@tanstack/react-router";

const TABS = [
  { to: "/projects/$projectId/overview", label: "Overview" },
  { to: "/projects/$projectId/all-tasks", label: "Tasks" },
  { to: "/projects/$projectId/timeline", label: "Timeline" },
  { to: "/projects/$projectId/members", label: "Members" },
  { to: "/projects/$projectId/media", label: "Media" },
  { to: "/projects/$projectId/pages", label: "Pages" },
] as const;

/** Tab bar for the project detail shell. Active tab derives from the route match. */
export function ProjectTabNav({ projectId }: { projectId: string }) {
  return (
    /* Pembungkus yang bisa di-scroll, bukan nav yang melar. Enam tab memakan
       ~463px; di bawah ~730px lebar konten, kontrol ini mendorong halaman dan
       SELURUH halaman ikut bergeser horizontal. Sebelum tab Overview ada,
       lima tab masih muat dan masalah ini belum kelihatan.

       Scroll, bukan `flex-wrap`: ini segmented control dengan track tunggal —
       kalau dibungkus jadi dua baris, track-nya patah jadi dua pil terpisah
       dan bentuknya berhenti terbaca sebagai satu kontrol.

       `scrollbar-slim` + `overflow-x-auto` mengikuti grid Timeline
       (`gantt-chart.tsx`), satu-satunya tempat lain di app ini yang menggeser
       konten lebar — bukan idiom ketiga. `mx-6 my-3` pindah ke pembungkus
       sebagai `px-6 py-3` supaya jarak tepinya tidak berubah, dan padding
       vertikal itu sekaligus memberi ruang bagi `shadow-1` pil aktif agar
       tidak terpotong oleh kotak scroll. */
    <div className="scrollbar-slim overflow-x-auto px-6 py-3">
      {/* Segmented control: track tenggelam, pil terangkat untuk yang aktif.
          `border-b` dilepas — kontrol ini menambatkan dirinya sendiri, dan garis
          di bawahnya justru mengembalikan tepi keras yang sengaja dibuang.

          Semua WARNA ada di activeProps/inactiveProps, tidak satu pun di
          className dasar. TanStack Router MENGGABUNGKAN className dengan
          activeProps.className, jadi dua utility berspesifisitas sama diadu oleh
          urutan sumber CSS — dan urutan itu milik Tailwind, bukan kita. Itulah
          sebabnya status aktif tab ini sebelumnya tidak terlihat sama sekali. */}
      <nav className="flex w-fit gap-1 rounded-full bg-surface-sunken p-[3px]">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ projectId }}
            className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors [transition-duration:var(--duration-fast)]"
            activeProps={{ className: "bg-surface-raised text-text shadow-1" }}
            inactiveProps={{ className: "text-text-muted hover:text-text" }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
