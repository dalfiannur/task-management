import { Link } from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { Skeleton } from "sedjiwa-ui";
import { EmptyState } from "@/components/shared/empty-state";
import { useDashboardStats } from "../api/hooks";
import { dueLabel } from "../due";
import type { ProjectProgress } from "../types";

const pct = (p: ProjectProgress) => (p.total > 0 ? p.done / p.total : 0);

/** Projects that most need a look go first: overdue work, then the least
 *  finished. Empty projects sink — a 0/0 bar says nothing. */
function byAttention(a: ProjectProgress, b: ProjectProgress): number {
  return (
    b.overdue - a.overdue ||
    Number(a.total === 0) - Number(b.total === 0) ||
    pct(a) - pct(b) ||
    a.projectName.localeCompare(b.projectName)
  );
}

/** Compact per-project progress for the dashboard rail. */
export function ProjectProgressList({ limit = 5 }: { limit?: number }) {
  const { stats, isLoading } = useDashboardStats();

  if (isLoading || !stats) {
    return <Skeleton className="h-48 w-full rounded-xl shadow-sm" />;
  }

  if (stats.perProject.length === 0) {
    return (
      <div className="rounded-xl bg-card shadow-sm">
        <EmptyState
          size="compact"
          icon={FolderKanban}
          title="No projects yet"
          body="Projects you're a member of show their progress here."
          action={{ label: "Browse projects", to: "/projects" }}
        />
      </div>
    );
  }

  const sorted = [...stats.perProject].sort(byAttention);
  const shown = sorted.slice(0, limit);
  const rest = sorted.length - shown.length;

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm">
      <ul>
        {shown.map((p) => (
          <li key={p.projectId} className="border-b border-border last:border-b-0">
            <Link
              to="/projects/$projectId/all-tasks"
              params={{ projectId: p.projectId }}
              className="block px-4 py-3 transition-colors [transition-duration:var(--duration-fast)] hover:bg-accent"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{p.projectName}</span>
                <span className="text-num shrink-0 text-xs text-muted-foreground">
                  {p.done}/{p.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(pct(p) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {p.overdue > 0 ? (
                  <span className="font-medium text-destructive">
                    <span className="text-num">{p.overdue}</span> overdue
                  </span>
                ) : p.nextDueDate ? (
                  <>
                    Next due{" "}
                    <span className="text-num">{dueLabel(p.nextDueDate)}</span>
                  </>
                ) : (
                  "No upcoming deadlines"
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <Link
          to="/projects"
          className="block border-t border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors [transition-duration:var(--duration-fast)] hover:bg-accent hover:text-foreground"
        >
          <span className="text-num">+{rest}</span> more project{rest > 1 && "s"}
        </Link>
      )}
    </div>
  );
}
