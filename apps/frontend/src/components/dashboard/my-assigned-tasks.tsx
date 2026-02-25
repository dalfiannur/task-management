import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import type { Task } from "@/types/task";
import { CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import styles from "./my-assigned-tasks.module.css";

interface MyAssignedTasksProps {
  tasks: Task[];
}

export function MyAssignedTasks({ tasks }: MyAssignedTasksProps) {
  const todoTasks = tasks.filter((t) => t.status === "todo");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const hasAny = todoTasks.length > 0 || inProgressTasks.length > 0;

  const groups = [
    { label: "In Progress", tasks: inProgressTasks.slice(0, 5) },
    { label: "Todo", tasks: todoTasks.slice(0, 5) },
  ].filter((g) => g.tasks.length > 0);

  return (
    <Card>
      <CardHeader className={styles.headerRow}>
        <CardTitle className={styles.cardTitle}>My Assigned Tasks</CardTitle>
        {hasAny && (
          <span className={styles.viewAllLink}>
            {todoTasks.length + inProgressTasks.length} open
          </span>
        )}
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <div className={styles.emptyState}>
            <CheckCircle2 className={styles.emptyIcon} />
            <p className={styles.emptyText}>No tasks assigned to you</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className={styles.statusGroup}>
              <div className={styles.statusLabel}>{group.label}</div>
              <div className={styles.taskList}>
                {group.tasks.map((task) => (
                  <div key={task.id} className={styles.taskRow}>
                    <TaskPriorityBadge priority={task.priority} />
                    <span className={styles.taskTitle}>{task.title}</span>
                    {task.dueDate && (
                      <span className={styles.taskDue}>
                        {format(new Date(task.dueDate), "MMM d")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
