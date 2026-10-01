import { Skeleton } from "@/components/ui/skeleton";
import { KpiStrip as KpiStripView } from "@/components/shared/kpi-strip";
import { useDashboardStats } from "../api/hooks";

/** The four headline counts across every project I'm in. Only Overdue takes
 *  colour, and only when it is non-zero. */
export function KpiStrip() {
  const { stats, isLoading } = useDashboardStats();

  if (isLoading || !stats) {
    return <Skeleton className="h-[88px] w-full rounded-xl shadow-2" />;
  }

  const donePct =
    stats.totalTasks > 0
      ? Math.round((stats.doneTasks / stats.totalTasks) * 100)
      : 0;

  return (
    <KpiStripView
      cells={[
        { label: "Total tasks", value: stats.totalTasks },
        { label: "In progress", value: stats.inProgressTasks },
        { label: "Done", value: stats.doneTasks, hint: `${donePct}%` },
        {
          label: "Overdue",
          value: stats.overdueTasks,
          alert: stats.overdueTasks > 0,
        },
      ]}
    />
  );
}
