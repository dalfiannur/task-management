export type TaskStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "cancelled";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface Module {
  id: string;
  name: string;
  description?: string;
  picId?: string;
  order: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string;
  dueDate?: string;
  order: number;
  assigneeIds: string[];
  moduleId: string;
  labelIds: string[];
  labels?: Label[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string;
  dueDate?: string;
  assigneeIds?: string[];
  moduleId: string;
  labelIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  startDate?: string | null;
  dueDate?: string | null;
  assigneeIds?: string[] | null;
  labelIds?: string[];
}

export interface User {
  id: string;
  externalId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string }
> = {
  todo: { label: "Todo", color: "status-todo" },
  in_progress: {
    label: "In Progress",
    color: "status-in-progress",
  },
  done: { label: "Done", color: "status-done" },
  cancelled: { label: "Cancelled", color: "status-cancelled" },
};

export const TASK_PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; icon: string }
> = {
  none: { label: "No priority", color: "priority-none", icon: "Minus" },
  low: { label: "Low", color: "priority-low", icon: "ArrowDown" },
  medium: { label: "Medium", color: "priority-medium", icon: "ArrowRight" },
  high: { label: "High", color: "priority-high", icon: "ArrowUp" },
  urgent: { label: "Urgent", color: "priority-urgent", icon: "AlertTriangle" },
};

export const BOARD_COLUMNS: TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
];
