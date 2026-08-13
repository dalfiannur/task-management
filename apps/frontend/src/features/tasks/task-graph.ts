// Derived views over a project's task list. Everything here is computed at
// render time from data already loaded — nothing is stored, so nothing can go
// stale. `ListTasks` returns every task in the project, which is what makes the
// reverse dependency index free.

import type { Task } from "./types";

/** Top-level tasks, and each parent's children in `order`. */
export function buildHierarchy(tasks: Task[]): {
  roots: Task[];
  childrenOf: Record<string, Task[]>;
} {
  const childrenOf: Record<string, Task[]> = {};
  const roots: Task[] = [];
  for (const t of tasks) {
    if (t.parentId) (childrenOf[t.parentId] ??= []).push(t);
    else roots.push(t);
  }
  for (const id of Object.keys(childrenOf)) {
    childrenOf[id].sort((a, b) => a.order - b.order);
  }
  roots.sort((a, b) => a.order - b.order);
  return { roots, childrenOf };
}

/** `2/3` progress for a parent. Returns null when it has no children. */
export function subtaskProgress(
  task: Task,
  childrenOf: Record<string, Task[]>,
): { done: number; total: number } | null {
  const kids = childrenOf[task.id];
  if (!kids?.length) return null;
  return { done: kids.filter((k) => k.status === "done").length, total: kids.length };
}

/** taskId → the tasks it blocks. Built from the one-directional store field. */
export function reverseDependencies(tasks: Task[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tasks) {
    for (const b of t.blockedByIds) (out[b] ??= []).push(t.id);
  }
  return out;
}

export type ConflictKind = "schedule" | "status";

/**
 * Conflicts on the edge blocker → task.
 *
 * `schedule`: the dependent starts before its blocker is due to finish.
 * `status`:   the dependent is already underway while its blocker is not done.
 *
 * A missing date yields no schedule conflict — nothing is guessed. Evaluated
 * per edge, never by walking the chain, which is why a dependency cycle is
 * harmless here.
 */
export function edgeConflicts(blocker: Task, dependent: Task): ConflictKind[] {
  const out: ConflictKind[] = [];
  if (dependent.startDate && blocker.dueDate && dependent.startDate < blocker.dueDate) {
    out.push("schedule");
  }
  if (
    (dependent.status === "in_progress" || dependent.status === "done") &&
    blocker.status !== "done"
  ) {
    out.push("status");
  }
  return out;
}

/** Every conflicting edge in the project, for the timeline and the badges. */
export function allConflicts(
  tasks: Task[],
): { blockerId: string; dependentId: string; kinds: ConflictKind[] }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: { blockerId: string; dependentId: string; kinds: ConflictKind[] }[] = [];
  for (const t of tasks) {
    for (const bId of t.blockedByIds) {
      const blocker = byId.get(bId);
      if (!blocker) continue; // deleted mid-session; the backend strips these
      const kinds = edgeConflicts(blocker, t);
      if (kinds.length) out.push({ blockerId: bId, dependentId: t.id, kinds });
    }
  }
  return out;
}
