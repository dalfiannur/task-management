import { create } from "@bufbuild/protobuf";
import {
  ActionSchema,
  ConditionsSchema,
  EmptySchema,
  NotifyActionSchema,
  NotifyTarget as PbTarget,
  RunStatus as PbRunStatus,
  TriggerSchema,
  type Action as PbAction,
  type Automation as PbAutomation,
  type AutomationRun as PbRun,
  type Trigger as PbTrigger,
} from "@/lib/gen/automations_pb";
import type { TaskPriority } from "@/features/tasks";
import type {
  Action,
  Automation,
  AutomationDraft,
  AutomationRun,
  NotifyTarget,
  Trigger,
} from "../types";

function triggerFromProto(t?: PbTrigger): Trigger | undefined {
  const k = t?.kind;
  switch (k?.case) {
    case "statusChanged":
      return {
        kind: "status_changed",
        fromStatusId: k.value.fromStatusId,
        toStatusId: k.value.toStatusId,
      };
    case "taskCreated":
      return { kind: "task_created" };
    case "assigneeAdded":
      return { kind: "assignee_added" };
    case "subtasksDone":
      return { kind: "subtasks_done" };
    case "overdue":
      return { kind: "overdue" };
    case "dueIn":
      return { kind: "due_in", days: k.value.days };
    default:
      return undefined;
  }
}

function triggerToProto(t: Trigger): PbTrigger {
  const empty = create(EmptySchema);
  switch (t.kind) {
    case "status_changed":
      return create(TriggerSchema, {
        kind: {
          case: "statusChanged",
          value: { fromStatusId: t.fromStatusId || undefined, toStatusId: t.toStatusId || undefined },
        },
      });
    case "due_in":
      return create(TriggerSchema, { kind: { case: "dueIn", value: { days: t.days } } });
    case "task_created":
      return create(TriggerSchema, { kind: { case: "taskCreated", value: empty } });
    case "assignee_added":
      return create(TriggerSchema, { kind: { case: "assigneeAdded", value: empty } });
    case "subtasks_done":
      return create(TriggerSchema, { kind: { case: "subtasksDone", value: empty } });
    case "overdue":
      return create(TriggerSchema, { kind: { case: "overdue", value: empty } });
  }
}

const TARGET_FROM: Record<number, NotifyTarget> = {
  [PbTarget.ASSIGNEES]: "assignees",
  [PbTarget.OWNER]: "owner",
  [PbTarget.USER]: "user",
};
const TARGET_TO: Record<NotifyTarget, PbTarget> = {
  assignees: PbTarget.ASSIGNEES,
  owner: PbTarget.OWNER,
  user: PbTarget.USER,
};

function actionFromProto(a: PbAction): Action | undefined {
  const k = a.kind;
  switch (k.case) {
    case "setStatusId":
      return { kind: "set_status", statusId: k.value };
    case "setPriority":
      return { kind: "set_priority", priority: k.value as TaskPriority };
    case "addLabelId":
      return { kind: "add_label", labelId: k.value };
    case "removeLabelId":
      return { kind: "remove_label", labelId: k.value };
    case "assignUserId":
      return { kind: "assign", userId: k.value };
    case "unassignAll":
      return { kind: "unassign_all" };
    case "moveToModuleId":
      return { kind: "move_to_module", moduleId: k.value };
    case "setDueInDays":
      return { kind: "set_due_in", days: k.value };
    case "notify":
      return {
        kind: "notify",
        target: TARGET_FROM[k.value.target] ?? "assignees",
        userId: k.value.userId,
        message: k.value.message,
      };
    case "comment":
      return { kind: "comment", text: k.value };
    default:
      return undefined;
  }
}

function actionToProto(a: Action): PbAction {
  const empty = create(EmptySchema);
  const kind = ((): PbAction["kind"] => {
    switch (a.kind) {
      case "set_status":
        return { case: "setStatusId", value: a.statusId };
      case "set_priority":
        return { case: "setPriority", value: a.priority };
      case "add_label":
        return { case: "addLabelId", value: a.labelId };
      case "remove_label":
        return { case: "removeLabelId", value: a.labelId };
      case "assign":
        return { case: "assignUserId", value: a.userId };
      case "unassign_all":
        return { case: "unassignAll", value: empty };
      case "move_to_module":
        return { case: "moveToModuleId", value: a.moduleId };
      case "set_due_in":
        return { case: "setDueInDays", value: a.days };
      case "notify":
        return {
          case: "notify",
          value: create(NotifyActionSchema, {
            target: TARGET_TO[a.target],
            userId: a.userId,
            message: a.message,
          }),
        };
      case "comment":
        return { case: "comment", value: a.text };
    }
  })();
  return create(ActionSchema, { kind });
}

export function mapAutomation(a: PbAutomation): Automation {
  return {
    id: a.id,
    projectId: a.projectId,
    name: a.name,
    enabled: a.enabled,
    trigger: triggerFromProto(a.trigger),
    conditions: {
      priorities: (a.conditions?.priorities ?? []) as TaskPriority[],
      labelIds: [...(a.conditions?.labelIds ?? [])],
      moduleIds: [...(a.conditions?.moduleIds ?? [])],
    },
    actions: a.actions.map(actionFromProto).filter((x): x is Action => !!x),
    createdBy: a.createdBy,
    runCount: a.runCount,
    lastRunAt: a.lastRunAt,
  };
}

const RUN_STATUS: Record<number, AutomationRun["status"]> = {
  [PbRunStatus.OK]: "ok",
  [PbRunStatus.FAILED]: "failed",
  [PbRunStatus.SKIPPED]: "skipped",
};

export function mapRun(r: PbRun): AutomationRun {
  return {
    id: r.id,
    automationId: r.automationId,
    automationName: r.automationName,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    taskNumber: r.taskNumber,
    trigger: r.trigger,
    status: RUN_STATUS[r.status] ?? "failed",
    detail: r.detail,
    createdAt: r.createdAt,
  };
}

/** The draft as SaveAutomationRequest fields. */
export function draftToProto(d: AutomationDraft) {
  return {
    name: d.name.trim(),
    trigger: triggerToProto(d.trigger),
    conditions: create(ConditionsSchema, {
      priorities: d.conditions.priorities,
      labelIds: d.conditions.labelIds,
      moduleIds: d.conditions.moduleIds,
    }),
    actions: d.actions.map(actionToProto),
  };
}
