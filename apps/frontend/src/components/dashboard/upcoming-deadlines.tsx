import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import type { Task } from "@/types/task";
import { CalendarClock } from "lucide-react";
import { formatDistanceToNow, isToday, isBefore, startOfDay, addDays } from "date-fns";
import styles from "./upcoming-deadlines.module.css";

function getUrgency(dueDate: string): "overdue" | "today" | "week" | "later" {
  const due = new Date(dueDate);
  const today = startOfDay(new Date());
  if (isBefore(due, today)) return "overdue";
  if (isToday(due)) return "today";
  if (isBefore(due, addDays(today, 7))) return "week";
  return "later";
}

const URGENCY_DOT: Record<string, string> = {
  overdue: styles.urgencyOverdue,
  today: styles.urgencyToday,
  week: styles.urgencyWeek,
  later: styles.urgencyLater,
};

const URGENCY_DUE: Record<string, string> = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  week: styles.dueWeek,
  later: styles.dueLater,
};

interface UpcomingDeadlinesProps {
  tasks: Task[];
}

export function UpcomingDeadlines({ tasks }: UpcomingDeadlinesProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className={styles.cardTitle}>Today's Deadlines</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className={styles.emptyState}>
            <CalendarClock className={styles.emptyIcon} />
            <p className={styles.emptyText}>No deadlines today</p>
          </div>
        ) : (
          <div className={styles.taskList}>
            {tasks.map((task) => {
              const urgency = getUrgency(task.dueDate!);
              const label =
                urgency === "overdue"
                  ? `${formatDistanceToNow(new Date(task.dueDate!))} overdue`
                  : urgency === "today"
                    ? "Today"
                    : formatDistanceToNow(new Date(task.dueDate!), { addSuffix: true });

              return (
                <div key={task.id} className={styles.taskRow}>
                  <span className={`${styles.urgencyDot} ${URGENCY_DOT[urgency]}`} />
                  <span className={styles.taskTitle}>{task.title}</span>
                  <TaskPriorityBadge priority={task.priority} />
                  <span className={`${styles.taskDue} ${URGENCY_DUE[urgency]}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
