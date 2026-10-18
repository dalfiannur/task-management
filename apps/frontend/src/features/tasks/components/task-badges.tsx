import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { dueGroup, dueLabel } from "@/features/dashboard";
import type { Task, TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG, statusLabel } from "../config";

/** "#12" before a task title. Inline-block, so a done title's line-through
 *  skips it. */
export function TaskNumber({
  number,
  className,
}: {
  number: number;
  className?: string;
}) {
  if (!number) return null;
  return (
    <span
      className={cn(
        "text-num mr-1.5 inline-block font-normal text-muted-foreground",
        className,
      )}
    >
      #{number}
    </span>
  );
}

type StatusFields = Pick<Task, "status" | "statusName" | "statusColor">;

/** The status colour dot: the workflow's own colour, else the category's
 *  token. Decorative — the name always travels next to it. */
export function StatusDot({
  status,
  color,
  className,
}: {
  status: TaskStatus;
  color?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        !color && TASK_STATUS_CONFIG[status].dot,
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/** Badge surface from the category (so done still reads as done), name and
 *  dot from the project's workflow. */
export function StatusBadge({ task }: { task: StatusFields }) {
  const c = TASK_STATUS_CONFIG[task.status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        c.badge,
      )}
    >
      <StatusDot status={task.status} color={task.statusColor} />
      {statusLabel(task)}
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
          ? "font-medium text-destructive"
          : group === "today"
            ? "font-medium text-warning-text"
            : "text-muted-foreground",
        className,
      )}
    >
      {open ? dueLabel(due) : format(parseISO(due), "d MMM")}
    </span>
  );
}
