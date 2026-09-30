import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { PriorityLabel } from "@/features/tasks";
import { useUpcomingDeadlines } from "../api/hooks";
import { dueGroup, dueLabel, type DueGroup } from "../due";
import type { MyTaskItem } from "../types";

const GROUPS: { key: DueGroup; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "later", label: "This week" },
];

/** My open work with a deadline — overdue first, then the next N days —
 *  grouped by when it is due. The one list on the dashboard that asks for
 *  action, so it gets the main column. */
export function NeedsAttention({ withinDays = 7 }: { withinDays?: number }) {
  const { items, isLoading } = useUpcomingDeadlines(withinDays, {
    includeOverdue: true,
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl shadow-2" />;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-surface-raised shadow-2">
        <EmptyState
          variant="cleared"
          size="compact"
          icon={CheckCircle2}
          title="You're all caught up"
          body={`Nothing assigned to you is overdue or due in the next ${withinDays} days.`}
          action={{ label: "Open My tasks", to: "/my-tasks" }}
        />
      </div>
    );
  }

  const grouped = new Map<DueGroup, MyTaskItem[]>();
  for (const it of items) {
    // The query only returns tasks with a due date.
    const g = dueGroup(it.task.dueDate!);
    grouped.set(g, [...(grouped.get(g) ?? []), it]);
  }

  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      {GROUPS.filter((g) => grouped.has(g.key)).map((g) => {
        const rows = grouped.get(g.key)!;
        const late = g.key === "overdue";
        return (
          <section
            key={g.key}
            className="border-b border-border-subtle last:border-b-0"
          >
            {/* Plain concatenation: cn()'s tailwind-merge would drop
                `text-label` next to `text-danger`. */}
            <h3
              className={`text-label flex items-center gap-2 px-4 pb-1 pt-3${late ? " text-danger" : ""}`}
            >
              {g.label}
              <span className="text-num font-normal">{rows.length}</span>
            </h3>
            <ul>
              {rows.map((it) => (
                <AttentionRow key={it.task.id} item={it} late={late} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AttentionRow({ item, late }: { item: MyTaskItem; late: boolean }) {
  const { task } = item;
  return (
    <li>
      <Link
        to="/projects/$projectId/all-tasks"
        params={{ projectId: item.projectId }}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{task.title}</span>
          <span className="block truncate text-xs text-text-muted">
            {item.projectName} · {item.moduleName}
          </span>
        </span>
        <PriorityLabel priority={task.priority} />
        <span
          className={cn(
            "text-num w-20 shrink-0 text-right text-xs",
            late ? "font-medium text-danger" : "text-text-muted",
          )}
          title={task.dueDate ?? undefined}
        >
          {dueLabel(task.dueDate!)}
        </span>
      </Link>
    </li>
  );
}
