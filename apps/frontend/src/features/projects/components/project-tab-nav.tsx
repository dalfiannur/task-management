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
    <nav className="flex gap-1 border-b px-6">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ projectId }}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{
            className: "border-primary text-foreground",
          }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
