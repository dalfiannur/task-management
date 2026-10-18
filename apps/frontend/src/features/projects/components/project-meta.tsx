// Small pieces the project card and the project row share: progress, the
// deadline note and the pin toggle.

import { Pin } from "lucide-react";
import { Progress } from "sedjiwa-ui";
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
    <Progress
      value={pct}
      size="sm"
      state={complete ? "success" : "default"}
      aria-label="Tasks done"
      className={className}
    />
  );
}

/** "3 overdue" beats "Next due …"; nothing when there is nothing to say. */
export function DueNote({ tasks }: { tasks: ProjectTasks }) {
  if (tasks.overdue > 0) {
    return (
      <span className="font-medium text-destructive">
        <span className="text-num">{tasks.overdue}</span> overdue
      </span>
    );
  }
  if (tasks.nextDueDate) {
    return (
      <span className="text-muted-foreground">
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
        "text-muted-foreground transition-colors [transition-duration:var(--duration-fast)] hover:bg-accent hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-ring",
        // Unpinned: only on hover/focus, so the grid stays quiet. Pinned: always.
        pinned
          ? "text-primary"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
    </button>
  );
}
