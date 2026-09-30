// Small pieces the project card and the project row share: progress, the
// deadline note and the pin toggle.

import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { dueLabel } from "@/features/dashboard";
import { usePinnedProjects } from "../atoms/pins";
import { donePct } from "../format";
import type { ProjectTasks } from "../types";

export function ProgressBar({
  tasks,
  className,
}: {
  tasks: ProjectTasks;
  className?: string;
}) {
  const pct = donePct(tasks);
  const complete = tasks.total > 0 && tasks.done === tasks.total;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Tasks done"
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-sunken", className)}
    >
      <div
        className={cn("h-full rounded-full", complete ? "bg-success" : "bg-brand")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** "3 overdue" beats "Next due …"; nothing when there is nothing to say. */
export function DueNote({ tasks }: { tasks: ProjectTasks }) {
  if (tasks.overdue > 0) {
    return (
      <span className="font-medium text-danger">
        <span className="text-num">{tasks.overdue}</span> overdue
      </span>
    );
  }
  if (tasks.nextDueDate) {
    return (
      <span className="text-text-muted">
        Next due <span className="text-num">{dueLabel(tasks.nextDueDate)}</span>
      </span>
    );
  }
  return null;
}

/** Sidebar pin toggle. Sits above the card's stretched link, so it never
 *  navigates. */
export function PinButton({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const pins = usePinnedProjects();
  const pinned = pins.isPinned(projectId);
  return (
    <button
      type="button"
      onClick={() => pins.toggle(projectId)}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
      className={cn(
        "relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        "text-text-muted transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover hover:text-text",
        "focus-visible:outline-2 focus-visible:outline-focus",
        // Unpinned: only on hover/focus, so the grid stays quiet. Pinned: always.
        pinned
          ? "text-brand-text"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
    </button>
  );
}
