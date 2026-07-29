// Display config for task status + priority (label, color classes).

import type { TaskPriority, TaskStatus } from "./types";

export const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; dot: string; badge: string }
> = {
  todo: {
    label: "To do",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-blue-500",
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  done: {
    label: "Done",
    dot: "bg-green-500",
    badge: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-muted-foreground/50",
    badge: "bg-muted text-muted-foreground line-through",
  },
};

export const TASK_PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; className: string }
> = {
  none: { label: "None", className: "text-muted-foreground" },
  low: { label: "Low", className: "text-slate-500" },
  medium: { label: "Medium", className: "text-amber-500" },
  high: { label: "High", className: "text-orange-500" },
  urgent: { label: "Urgent", className: "text-red-500" },
};
