import { Link } from "@tanstack/react-router";
import { StatusBadge, PriorityLabel } from "@/features/tasks";
import type { MyTaskItem } from "../types";

/** One task row with project/module context — links to the owning project. */
export function MyTaskRow({ item }: { item: MyTaskItem }) {
  const { task } = item;
  return (
    <Link
      to="/projects/$projectId/all-tasks"
      params={{ projectId: item.projectId }}
      className="flex items-center gap-3 rounded-md border-b px-2 py-2 last:border-b-0 hover:bg-surface-sunken/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{task.title}</span>
        <span className="block truncate text-xs text-text-muted">
          {item.projectName} · {item.moduleName}
        </span>
      </span>
      <PriorityLabel priority={task.priority} />
      {task.dueDate && (
        <span className="text-xs text-text-muted">{task.dueDate}</span>
      )}
      <StatusBadge status={task.status} />
    </Link>
  );
}
