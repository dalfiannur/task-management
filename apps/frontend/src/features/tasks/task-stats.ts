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
}

export function isOverdue(task: Task, today = new Date().toISOString().slice(0, 10)) {
  const open = task.status === "todo" || task.status === "in_progress";
  return open && !!task.dueDate && task.dueDate.slice(0, 10) < today;
}

export function statsByModule(tasks: Task[]): Record<string, ModuleStats> {
  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, ModuleStats> = {};
  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    const s = (out[t.moduleId] ??= { done: 0, total: 0, overdue: 0 });
    s.total += 1;
    if (t.status === "done") s.done += 1;
    if (isOverdue(t, today)) s.overdue += 1;
  }
  return out;
}
