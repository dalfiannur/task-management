import { Link } from "@tanstack/react-router";

const TABS = [
  { to: "/projects/$projectId/all-tasks", label: "Tasks" },
  { to: "/projects/$projectId/timeline", label: "Timeline" },
  { to: "/projects/$projectId/members", label: "Members" },
  { to: "/projects/$projectId/media", label: "Media" },
  { to: "/projects/$projectId/pages", label: "Pages" },
] as const;

/** Tab bar for the project detail shell. Active tab derives from the route match. */
export function ProjectTabNav({ projectId }: { projectId: string }) {
  return (
    /* Segmented control: track tenggelam, pil terangkat untuk yang aktif.
       `border-b` dilepas — kontrol ini menambatkan dirinya sendiri, dan garis
       di bawahnya justru mengembalikan tepi keras yang sengaja dibuang.

       Semua WARNA ada di activeProps/inactiveProps, tidak satu pun di
       className dasar. TanStack Router MENGGABUNGKAN className dengan
       activeProps.className, jadi dua utility berspesifisitas sama diadu oleh
       urutan sumber CSS — dan urutan itu milik Tailwind, bukan kita. Itulah
       sebabnya status aktif tab ini sebelumnya tidak terlihat sama sekali. */
    <nav className="mx-6 my-3 flex w-fit gap-1 rounded-full bg-surface-sunken p-[3px]">
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
  );
}
