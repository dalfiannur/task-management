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
      className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors [transition-duration:var(--duration-fast)] last:border-b-0 hover:bg-surface-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{task.title}</span>
        <span className="block truncate text-xs text-text-muted">
          {item.projectName} · {item.moduleName}
        </span>
      </span>
      <PriorityLabel priority={task.priority} />
      {task.dueDate && (
        <span className="text-num text-xs text-text-muted">{task.dueDate}</span>
      )}
      <StatusBadge status={task.status} />
    </Link>
  );
}
