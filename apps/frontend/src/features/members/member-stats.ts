// Per-member workload for the Members tab. Pure.
//
// Same counting rules as the Tasks tab's module headers (`statsByModule`):
// cancelled tasks are left out, and "overdue" is `isOverdue`. A task with two
// assignees counts once for each of them — it is on both of their plates.

import { isOverdue, type Task } from "@/features/tasks";

export interface MemberStats {
  open: number;
  overdue: number;
  done: number;
  /** done + open — the denominator of the progress bar. */
  total: number;
}

export interface ProjectWorkload {
  byUser: Record<string, MemberStats>;
  /** Open tasks nobody is assigned to. */
  unassigned: number;
  /** Open tasks with at least one assignee (each counted once). */
  assignedOpen: number;
  overdue: number;
}

export const EMPTY_MEMBER_STATS: MemberStats = {
  open: 0,
  overdue: 0,
  done: 0,
  total: 0,
};

export function workloadByMember(tasks: Task[]): ProjectWorkload {
  const today = new Date().toISOString().slice(0, 10);
  const byUser: Record<string, MemberStats> = {};
  let unassigned = 0;
  let assignedOpen = 0;
  let overdue = 0;

  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    const done = t.status === "done";
    const late = isOverdue(t, today);
    if (!done) {
      if (t.assigneeIds.length === 0) unassigned += 1;
      else assignedOpen += 1;
      if (late) overdue += 1;
    }
    for (const id of t.assigneeIds) {
      const s = (byUser[id] ??= { ...EMPTY_MEMBER_STATS });
      s.total += 1;
      if (done) s.done += 1;
      else s.open += 1;
      if (late) s.overdue += 1;
    }
  }

  return { byUser, unassigned, assignedOpen, overdue };
}
