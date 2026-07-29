import type {
  Module as PbModule,
  Task as PbTask,
} from "@/lib/gen/work_pb";
import { TaskStatus as PbStatus, TaskPriority as PbPriority } from "@/lib/gen/work_pb";
import type { Module, Task, TaskPriority, TaskStatus } from "../types";

export function statusFromProto(s: PbStatus): TaskStatus {
  switch (s) {
    case PbStatus.TODO:
      return "todo";
    case PbStatus.IN_PROGRESS:
      return "in_progress";
    case PbStatus.DONE:
      return "done";
    case PbStatus.CANCELLED:
      return "cancelled";
    default:
      return "todo";
  }
}

export function statusToProto(s: TaskStatus): PbStatus {
  switch (s) {
    case "todo":
      return PbStatus.TODO;
    case "in_progress":
      return PbStatus.IN_PROGRESS;
    case "done":
      return PbStatus.DONE;
    case "cancelled":
      return PbStatus.CANCELLED;
  }
}

export function priorityFromProto(p: PbPriority): TaskPriority {
  switch (p) {
    case PbPriority.LOW:
      return "low";
    case PbPriority.MEDIUM:
      return "medium";
    case PbPriority.HIGH:
      return "high";
    case PbPriority.URGENT:
      return "urgent";
    default:
      return "none";
  }
}

export function priorityToProto(p: TaskPriority): PbPriority {
  switch (p) {
    case "none":
      return PbPriority.NONE;
    case "low":
      return PbPriority.LOW;
    case "medium":
      return PbPriority.MEDIUM;
    case "high":
      return PbPriority.HIGH;
    case "urgent":
      return PbPriority.URGENT;
  }
}

export function mapModule(m: PbModule): Module {
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? "",
    order: m.order,
  };
}

export function mapTask(t: PbTask): Task {
  return {
    id: t.id,
    moduleId: t.moduleId,
    title: t.title,
    description: t.description,
    status: statusFromProto(t.status),
    priority: priorityFromProto(t.priority),
    startDate: t.startDate,
    dueDate: t.dueDate,
    order: t.order,
    assigneeIds: t.assigneeIds,
    labelIds: t.labelIds,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    completedAt: t.completedAt,
    createdBy: t.createdBy,
  };
}
