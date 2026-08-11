import { cn } from "@/lib/utils";
import type { TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "../config";

export function StatusBadge({ status }: { status: TaskStatus }) {
  const c = TASK_STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
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
