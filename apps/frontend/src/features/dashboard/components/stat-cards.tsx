import { Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, ListTodo, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDashboardStats } from "../api/hooks";

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full bg-muted",
            tone,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
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
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
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
          tone="text-blue-500"
        />
        <StatCard
          icon={CheckCircle2}
          label="Done"
          value={stats.doneTasks}
          tone="text-green-500"
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue"
          value={stats.overdueTasks}
          tone="text-red-500"
        />
      </div>

      {stats.perProject.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Per project
          </h2>
          <ul className="space-y-2">
            {stats.perProject.map((p) => {
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <li key={p.projectId}>
                  <Link
                    to="/projects/$projectId/all-tasks"
                    params={{ projectId: p.projectId }}
                    className="block rounded-md border p-3 hover:bg-muted/40"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">
                        {p.projectName}
                      </span>
                      <span className="text-muted-foreground">
                        {p.done}/{p.total}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
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
