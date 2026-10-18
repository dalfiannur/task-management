// Per-module progress for the Tasks tab headers. Pure.
//
// Cancelled tasks are out of the tally — they'll never be done, so counting
// them would pin a finished module below 100%. "Overdue" is the server's
// rule (open, due before today in UTC), the same one the dashboard counts by.

import type { Task } from "./types";

export interface ModuleStats {
  done: number;
  total: number;
  overdue: number;
  /** Effort still to do on open tasks, see `remainingMinutes`. */
  openEstimate: number;
}

/** Parents whose own estimate is superseded by their subtasks' estimates. */
export function estimatedParents(tasks: Task[]): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) if (t.parentId && t.estimateMinutes) out.add(t.parentId);
  return out;
}

/**
 * Effort left on one task: its estimate minus the time logged on it, never
 * below zero. A parent whose subtasks carry estimates counts as zero — the
 * subtasks hold the effort, and counting both would double it. Same rule as
 * the server's workload.
 */
export function remainingMinutes(task: Task, parents: Set<string>): number {
  if (parents.has(task.id)) return 0;
  return Math.max((task.estimateMinutes ?? 0) - task.loggedMinutes, 0);
}

export function isOverdue(task: Task, today = new Date().toISOString().slice(0, 10)) {
  const open = task.status === "todo" || task.status === "in_progress";
  return open && !!task.dueDate && task.dueDate.slice(0, 10) < today;
}

export function statsByModule(tasks: Task[]): Record<string, ModuleStats> {
  const today = new Date().toISOString().slice(0, 10);
  const parents = estimatedParents(tasks);
  const out: Record<string, ModuleStats> = {};
  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    const s = (out[t.moduleId] ??= { done: 0, total: 0, overdue: 0, openEstimate: 0 });
    s.total += 1;
    if (t.status === "done") s.done += 1;
    else s.openEstimate += remainingMinutes(t, parents);
    if (isOverdue(t, today)) s.overdue += 1;
  }
  return out;
}
