export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface Module {
  id: string;
  name: string;
  description?: string;
  // projectId: string;
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
  backlog: { label: "Backlog", color: "bg-gray-100 text-gray-700" },
  todo: { label: "Todo", color: "bg-blue-100 text-blue-700" },
  in_progress: {
    label: "In Progress",
    color: "bg-yellow-100 text-yellow-700",
  },
  in_review: { label: "In Review", color: "bg-purple-100 text-purple-700" },
  done: { label: "Done", color: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
};

export const TASK_PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; icon: string }
> = {
  none: { label: "No priority", color: "text-gray-400", icon: "Minus" },
  low: { label: "Low", color: "text-blue-500", icon: "ArrowDown" },
  medium: { label: "Medium", color: "text-yellow-500", icon: "ArrowRight" },
  high: { label: "High", color: "text-orange-500", icon: "ArrowUp" },
  urgent: { label: "Urgent", color: "text-red-500", icon: "AlertTriangle" },
};

export const BOARD_COLUMNS: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
];
