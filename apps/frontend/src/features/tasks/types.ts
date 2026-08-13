// Flat FE types for the work domain (modules + tasks), mapped from gen/work_pb.

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface Module {
  id: string;
  name: string;
  description: string;
  order: number;
}

export interface Task {
  id: string;
  moduleId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string;
  dueDate?: string;
  order: number;
  assigneeIds: string[];
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  createdBy: string;
  /** Set when this task is a subtask. One level only — a subtask has none. */
  parentId?: string;
  /** Tasks that should finish before this one starts (finish-to-start). */
  blockedByIds: string[];
}

export const TASK_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
  "cancelled",
];
export const TASK_PRIORITIES: TaskPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];
