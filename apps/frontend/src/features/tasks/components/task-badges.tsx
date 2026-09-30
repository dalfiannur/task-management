import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { dueGroup, dueLabel } from "@/features/dashboard";
import type { Task, TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "../config";

export function StatusBadge({ status }: { status: TaskStatus }) {
  const c = TASK_STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        c.badge,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

export function PriorityLabel({ priority }: { priority: TaskPriority }) {
  if (priority === "none") return null;
  const c = TASK_PRIORITY_CONFIG[priority];
  return (
    <span className={cn("text-xs font-medium", c.className)}>{c.label}</span>
  );
}

/** A task's due date in the dashboard's wording ("3d late", "Today", "Fri 3
 *  Oct"). Only an open task can be late — a done or cancelled one just shows
 *  its date, uncoloured. */
export function DueDate({
  task,
  className,
}: {
  task: Pick<Task, "dueDate" | "status">;
  className?: string;
}) {
  if (!task.dueDate) return null;
  const due = task.dueDate.slice(0, 10);
  const open = task.status === "todo" || task.status === "in_progress";
  const group = open ? dueGroup(due) : "later";
  return (
    <span
      title={due}
      className={cn(
        "text-num text-xs whitespace-nowrap",
        group === "overdue"
          ? "font-medium text-danger"
          : group === "today"
            ? "font-medium text-warning"
            : "text-text-muted",
        className,
      )}
    >
      {open ? dueLabel(due) : format(parseISO(due), "d MMM")}
    </span>
  );
}
