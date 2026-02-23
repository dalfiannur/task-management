import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TASK_STATUS_CONFIG, type TaskStatus, type Task } from "@/types/task";
import styles from "./task-distribution.module.css";

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
      <CardHeader className={styles.headerRow}>
        <CardTitle className={styles.cardTitle}>Task Overview</CardTitle>
        <span className={styles.totalCount}>
          {total}
        </span>
      </CardHeader>
      <CardContent className={styles.contentArea}>
        {total === 0 ? (
          <p className={styles.emptyText}>
            No tasks yet.
          </p>
        ) : (
          nonZeroStatuses.map((status, i) => {
            const count = counts[status];
            const pct = Math.round((count / total) * 100);
            const color = STATUS_COLORS[status];

            return (
              <div key={status} className={styles.statusGroup}>
                <div className={styles.statusRow}>
                  <div className={styles.statusLabel}>
                    <span
                      className={styles.statusDot}
                      style={{ backgroundColor: color }}
                    />
                    <span className={styles.statusLabelText}>
                      {TASK_STATUS_CONFIG[status].label}
                    </span>
                  </div>
                  <div className={styles.statusValues}>
                    <span className={styles.statusCount}>
                      {count}
                    </span>
                    <span className={styles.statusPercent}>
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressBar}
                    style={{
                      width: `${pct}%`,
                      backgroundColor: color,
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
