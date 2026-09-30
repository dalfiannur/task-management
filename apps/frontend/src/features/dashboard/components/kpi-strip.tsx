import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDashboardStats } from "../api/hooks";

/** The four headline counts as one hairline-divided strip.
 *
 *  One card instead of four: the numbers are read together, so they share a
 *  surface. The dividers are the gap between cells showing the border colour
 *  underneath — they stay one pixel whether the grid is 2×2 or 1×4. Only
 *  Overdue takes colour, and only when it is non-zero (aturan 4). */
export function KpiStrip() {
  const { stats, isLoading } = useDashboardStats();

  if (isLoading || !stats) {
    return <Skeleton className="h-[88px] w-full rounded-xl shadow-2" />;
  }

  const donePct =
    stats.totalTasks > 0
      ? Math.round((stats.doneTasks / stats.totalTasks) * 100)
      : 0;

  const cells: {
    label: string;
    value: number;
    hint?: string;
    alert?: boolean;
  }[] = [
    { label: "Total tasks", value: stats.totalTasks },
    { label: "In progress", value: stats.inProgressTasks },
    { label: "Done", value: stats.doneTasks, hint: `${donePct}%` },
    { label: "Overdue", value: stats.overdueTasks, alert: stats.overdueTasks > 0 },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border-subtle shadow-2 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface-raised px-5 py-4">
          {/* Not cn(): tailwind-merge reads `text-label` as a font-size and
              would drop it in favour of `text-danger`. */}
          <dt className={c.alert ? "text-label text-danger" : "text-label"}>
            {c.label}
          </dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                "text-num text-2xl font-semibold",
                c.alert ? "text-danger" : "text-text",
              )}
            >
              {c.value}
            </span>
            {c.hint && (
              <span className="text-num text-xs text-text-muted">{c.hint}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
