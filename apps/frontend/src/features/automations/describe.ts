// Plain-English sentences for rules, and the presets offered when creating
// one. Pure.

import { formatDistanceToNowStrict } from "date-fns";
import type { Action, AutomationDraft, Conditions, Trigger } from "./types";

/** Names for the ids a rule points at. */
export interface Names {
  status: (id: string) => string;
  label: (id: string) => string;
  module: (id: string) => string;
  user: (id: string) => string;
}

const PRIORITY: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function describeTrigger(t: Trigger | undefined, n: Names): string {
  if (!t) return "When … (this rule no longer reads correctly — edit it)";
  switch (t.kind) {
    case "status_changed": {
      const from = t.fromStatusId ? ` from ${n.status(t.fromStatusId)}` : "";
      const to = t.toStatusId ? ` to ${n.status(t.toStatusId)}` : "";
      return from || to ? `When status changes${from}${to}` : "When status changes";
    }
    case "task_created":
      return "When a task is created";
    case "assignee_added":
      return "When someone is assigned";
    case "subtasks_done":
      return "When all subtasks are done";
    case "overdue":
      return "When a task becomes overdue";
    case "due_in":
      return `When a task is due within ${t.days} day${t.days === 1 ? "" : "s"}`;
  }
}

export function describeConditions(c: Conditions, n: Names): string {
  const parts: string[] = [];
  if (c.priorities.length) parts.push(`priority is ${c.priorities.map((p) => PRIORITY[p] ?? p).join(" or ")}`);
  if (c.labelIds.length) parts.push(`label is ${c.labelIds.map(n.label).join(" or ")}`);
  if (c.moduleIds.length) parts.push(`module is ${c.moduleIds.map(n.module).join(" or ")}`);
  return parts.length ? `if ${parts.join(" and ")}` : "";
}

export function describeAction(a: Action, n: Names): string {
  switch (a.kind) {
    case "set_status":
      return `set status to ${n.status(a.statusId)}`;
    case "set_priority":
      return `set priority to ${PRIORITY[a.priority] ?? a.priority}`;
    case "add_label":
      return `add label ${n.label(a.labelId)}`;
    case "remove_label":
      return `remove label ${n.label(a.labelId)}`;
    case "assign":
      return a.userId ? `assign ${n.user(a.userId)}` : "assign the task's creator";
    case "unassign_all":
      return "unassign everyone";
    case "move_to_module":
      return `move to ${n.module(a.moduleId)}`;
    case "set_due_in":
      return a.days === 0 ? "set due date to today" : `set due date ${a.days} day${a.days === 1 ? "" : "s"} out`;
    case "notify": {
      const who = a.target === "assignees" ? "the assignees" : a.target === "owner" ? "the project owner" : n.user(a.userId);
      return `notify ${who}`;
    }
    case "comment":
      return "add a comment";
  }
}

export function describeRule(
  r: Pick<AutomationDraft, "conditions" | "actions"> & { trigger?: Trigger },
  n: Names,
): string {
  const cond = describeConditions(r.conditions, n);
  return `${describeTrigger(r.trigger, n)}${cond ? `, ${cond}` : ""} → ${r.actions.map((a) => describeAction(a, n)).join(", ")}`;
}

export function lastRunLabel(iso?: string): string {
  if (!iso) return "never ran";
  return `last ran ${formatDistanceToNowStrict(new Date(iso), { addSuffix: true })}`;
}

const NO_CONDITIONS: Conditions = { priorities: [], labelIds: [], moduleIds: [] };

/**
 * Starting points. Ids are filled from the project when it has a matching
 * status or label; otherwise the action is left for the user to pick.
 */
export function presets(project: {
  doneStatusId?: string;
  reviewStatusId?: string;
  lateLabelId?: string;
}): { key: string; title: string; draft: AutomationDraft }[] {
  const out: { key: string; title: string; draft: AutomationDraft }[] = [
    {
      key: "done-unassign",
      title: "When done, clear the assignees",
      draft: {
        name: "Done → unassign",
        trigger: { kind: "status_changed", toStatusId: project.doneStatusId },
        conditions: NO_CONDITIONS,
        actions: [{ kind: "unassign_all" }],
      },
    },
    {
      key: "overdue",
      title: "When overdue, flag it and tell the owner",
      draft: {
        name: "Overdue alert",
        trigger: { kind: "overdue" },
        conditions: NO_CONDITIONS,
        actions: [
          ...(project.lateLabelId ? [{ kind: "add_label", labelId: project.lateLabelId } as Action] : []),
          { kind: "notify", target: "owner", userId: "", message: "A task is overdue." },
        ],
      },
    },
    {
      key: "subtasks-review",
      title: "When all subtasks are done, move the parent to review",
      draft: {
        name: "Subtasks done → review",
        trigger: { kind: "subtasks_done" },
        conditions: NO_CONDITIONS,
        actions: [{ kind: "set_status", statusId: project.reviewStatusId ?? project.doneStatusId ?? "" }],
      },
    },
    {
      key: "due-soon",
      title: "When due within 2 days, remind the assignees",
      draft: {
        name: "Due soon reminder",
        trigger: { kind: "due_in", days: 2 },
        conditions: NO_CONDITIONS,
        actions: [{ kind: "notify", target: "assignees", userId: "", message: "Due in 2 days." }],
      },
    },
  ];
  return out;
}
