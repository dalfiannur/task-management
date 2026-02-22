import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TASK_STATUS_CONFIG, type TaskStatus, type Task } from "@/types/task";

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: "#94a3b8",
  todo: "#38bdf8",
  in_progress: "#fbbf24",
  in_review: "#a78bfa",
  done: "#34d399",
  cancelled: "#fb7185",
};

interface TaskDistributionProps {
  tasks: Task[];
}

export function TaskDistribution({ tasks }: TaskDistributionProps) {
  const total = tasks.length;

  const counts = (Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).reduce(
    (acc, status) => {
      acc[status] = tasks.filter((t) => t.status === status).length;
      return acc;
    },
    {} as Record<TaskStatus, number>,
  );

  const nonZeroStatuses = (
    Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]
  ).filter((s) => counts[s] > 0);

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between space-y-0">
        <CardTitle className="text-base font-semibold">Task Overview</CardTitle>
        <span
          className="text-3xl font-bold font-display tracking-tight"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {total}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No tasks yet.
          </p>
        ) : (
          nonZeroStatuses.map((status, i) => {
            const count = counts[status];
            const pct = Math.round((count / total) * 100);
            const color = STATUS_COLORS[status];

            return (
              <div key={status} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-muted-foreground">
                      {TASK_STATUS_CONFIG[status].label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="font-semibold font-display"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {count}
                    </span>
                    <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: color,
                      transformOrigin: "left",
                      animation: "bar-fill 0.8s ease-out both",
                      animationDelay: `${i * 80 + 200}ms`,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
