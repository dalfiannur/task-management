// Client-side filtering for the project Tasks tab.
//
// Pure — no React, no network. `ListTasks` only narrows by project/module, so
// the whole project's task list is already in memory; every dimension here is
// applied over that list.
//
// Dates are compared as plain `YYYY-MM-DD` strings, the same way the backend
// compares them (`domain::task::dates_ok`). `datePart` trims anything past the
// tenth character so a record holding a full instant still compares as a date
// instead of poisoning the comparison.

import { coerceSearchParam } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus } from "./types";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types";

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  /** A single user id; a task matches when it is among its assignees. */
  assignee?: string;
  /** A single label id. */
  label?: string;
  /** Inclusive range bounds, `YYYY-MM-DD`. Either end may stand alone. */
  from?: string;
  to?: string;
}

export function hasActiveFilter(f: TaskFilter): boolean {
  return !!(f.status || f.priority || f.assignee || f.label || f.from || f.to);
}

function datePart(v?: string): string | undefined {
  return v ? v.slice(0, 10) : undefined;
}

/**
 * Overlap between a task's lifetime and the filter range.
 *
 * A task's lifetime is `[startDate, dueDate]`, with a single date standing for
 * both ends when only one is set. A task with neither date has no position in
 * time at all, so it cannot overlap anything — it drops out while a date bound
 * is active rather than being silently kept.
 */
function matchesDateRange(task: Task, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const start = datePart(task.startDate) ?? datePart(task.dueDate);
  const end = datePart(task.dueDate) ?? datePart(task.startDate);
  if (!start || !end) return false;
  if (to && start > to) return false;
  if (from && end < from) return false;
  return true;
}

export function matchesFilter(task: Task, f: TaskFilter): boolean {
  if (f.status && task.status !== f.status) return false;
  if (f.priority && task.priority !== f.priority) return false;
  if (f.assignee && !task.assigneeIds.includes(f.assignee)) return false;
  if (f.label && !task.labelIds.includes(f.label)) return false;
  return matchesDateRange(task, f.from, f.to);
}

/**
 * Filter a task list without ever breaking the parent→subtask hierarchy the
 * rows are rendered from.
 *
 * A kept subtask always keeps its parent: `ModuleSection` renders children off
 * their root, so a child whose parent was dropped would vanish from the screen
 * entirely rather than showing up on its own. Hence two rules:
 *
 *   - a parent that matches keeps ALL its children, so the `2/3` subtask
 *     progress on its row stays honest about the task as it really is;
 *   - a parent that does not match is still shown, as context, when at least
 *     one of its children matches — but then only the matching children come
 *     with it.
 *
 * A subtask whose parent is absent from `tasks` (not expected — the backend
 * keeps parent and child in one module) is treated as a root so it cannot be
 * dropped by accident.
 */
export function filterTasks(tasks: Task[], f: TaskFilter): Task[] {
  if (!hasActiveFilter(f)) return tasks;

  const ids = new Set(tasks.map((t) => t.id));
  const isRoot = (t: Task) => !t.parentId || !ids.has(t.parentId);

  const childrenOf: Record<string, Task[]> = {};
  const roots: Task[] = [];
  for (const t of tasks) {
    if (isRoot(t)) roots.push(t);
    else (childrenOf[t.parentId!] ??= []).push(t);
  }

  const keep = new Set<string>();
  for (const root of roots) {
    const children = childrenOf[root.id] ?? [];
    if (matchesFilter(root, f)) {
      keep.add(root.id);
      for (const c of children) keep.add(c.id);
      continue;
    }
    const matching = children.filter((c) => matchesFilter(c, f));
    if (matching.length === 0) continue;
    keep.add(root.id);
    for (const c of matching) keep.add(c.id);
  }

  return tasks.filter((t) => keep.has(t.id));
}

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Read a `TaskFilter` out of raw URL search params.
 *
 * Every field is dropped rather than defaulted when it is malformed: a
 * hand-edited `?status=bogus` shows the unfiltered list, which is the honest
 * outcome — inventing a default would filter the list by something the URL
 * never asked for. Dates must be exactly `YYYY-MM-DD` so an instant pasted in
 * by hand is rejected instead of silently truncated.
 */
export function parseTaskFilter(search: Record<string, unknown>): TaskFilter {
  const date = (v: unknown) =>
    typeof v === "string" && PLAIN_DATE_RE.test(v) ? v : undefined;
  return {
    status: oneOf(search.status, TASK_STATUSES),
    priority: oneOf(search.priority, TASK_PRIORITIES),
    assignee: coerceSearchParam(search.assignee),
    label: coerceSearchParam(search.label),
    from: date(search.from),
    to: date(search.to),
  };
}
