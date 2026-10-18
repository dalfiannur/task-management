// Flat FE types for automations, mapped from gen/automations_pb.

import type { TaskPriority } from "@/features/tasks";

export type Trigger =
  | { kind: "status_changed"; fromStatusId?: string; toStatusId?: string }
  | { kind: "task_created" }
  | { kind: "assignee_added" }
  | { kind: "subtasks_done" }
  | { kind: "overdue" }
  | { kind: "due_in"; days: number };

export type TriggerKind = Trigger["kind"];

export interface Conditions {
  priorities: TaskPriority[];
  labelIds: string[];
  moduleIds: string[];
}

export type NotifyTarget = "assignees" | "owner" | "user";

export type Action =
  | { kind: "set_status"; statusId: string }
  | { kind: "set_priority"; priority: TaskPriority }
  | { kind: "add_label"; labelId: string }
  | { kind: "remove_label"; labelId: string }
  /** `userId` "" = the task's creator. */
  | { kind: "assign"; userId: string }
  | { kind: "unassign_all" }
  | { kind: "move_to_module"; moduleId: string }
  | { kind: "set_due_in"; days: number }
  | { kind: "notify"; target: NotifyTarget; userId: string; message: string }
  | { kind: "comment"; text: string };

export type ActionKind = Action["kind"];

export interface Automation {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  /** Undefined when the stored rule no longer parses. */
  trigger?: Trigger;
  conditions: Conditions;
  actions: Action[];
  createdBy: string;
  runCount: number;
  lastRunAt?: string;
}

export type RunStatus = "ok" | "failed" | "skipped";

export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  taskId: string;
  taskTitle: string;
  taskNumber: number;
  trigger: string;
  status: RunStatus;
  detail: string;
  createdAt: string;
}

/** What a new rule's form starts from. */
export interface AutomationDraft {
  name: string;
  trigger: Trigger;
  conditions: Conditions;
  actions: Action[];
}

export const MAX_ACTIONS = 5;
