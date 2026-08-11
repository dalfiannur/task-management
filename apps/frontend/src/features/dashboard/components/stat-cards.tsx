import { Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, ListTodo, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDashboardStats } from "../api/hooks";

/** Hanya "Overdue" yang menuntut tindakan, jadi hanya ia yang diberi warna
 *  penuh. Sebelumnya keempat kartu punya ikon berwarna sendiri — kalau semua
 *  menonjol, tidak ada yang menonjol (aturan 4). Sisanya diredupkan. */
function StatCard({
  icon: Icon,
  label,
  value,
  alert = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            alert
              ? "bg-danger-subtle text-danger"
              : "bg-surface-sunken text-text-muted",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <div
            className={cn(
              "text-num text-2xl font-semibold",
              alert ? "text-danger" : "text-text",
            )}
          >
            {value}
          </div>
          <div className="text-label">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCards() {
  const { stats, isLoading } = useDashboardStats();

  if (isLoading || !stats) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl shadow-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ListTodo} label="Total tasks" value={stats.totalTasks} />
        <StatCard
          icon={Clock}
          label="In progress"
          value={stats.inProgressTasks}
        />
        <StatCard icon={CheckCircle2} label="Done" value={stats.doneTasks} />
        <StatCard
          icon={AlertTriangle}
          label="Overdue"
          value={stats.overdueTasks}
          alert
        />
      </div>

      {stats.perProject.length > 0 && (
        /* Ruang di atas heading > di bawahnya (aturan 7): heading milik
           bagian yang mengikutinya. */
        <div className="pt-2">
          <h2 className="text-label mb-3">Per project</h2>
          <ul className="space-y-2">
            {stats.perProject.map((p) => {
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <li key={p.projectId}>
                  <Link
                    to="/projects/$projectId/all-tasks"
                    params={{ projectId: p.projectId }}
                    className="block rounded-xl bg-surface-raised p-3 shadow-1 transition-shadow [transition-duration:var(--duration-fast)] hover:shadow-2"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">
                        {p.projectName}
                      </span>
                      <span className="text-num text-text-muted">
                        {p.done}/{p.total}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
