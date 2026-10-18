import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "sedjiwa-ui";
import { cn } from "@/lib/utils";
import type { Task } from "../types";
import { TASK_STATUS_CONFIG, statusLabel } from "../config";
import { isOptimisticTaskId, useStatuses, useUpdateTask } from "../api/hooks";
import { StatusDot } from "./task-badges";

/**
 * The status badge, as a menu: move a task to another status of its
 * project's workflow without opening the dialog. Optimistic through `useUpdateTask`, which also reports a failure
 * and rolls the row back.
 */
export function StatusMenu({
  projectId,
  task,
  compact = false,
  className,
}: {
  projectId: string;
  task: Task;
  /** Icon-only trigger, for places that already show the status (a board
   *  column). */
  compact?: boolean;
  className?: string;
}) {
  const update = useUpdateTask(projectId);
  const { statuses } = useStatuses(projectId);
  const c = TASK_STATUS_CONFIG[task.status];
  const label = statusLabel(task);
  // No server id yet — nothing to send the change to.
  const pending = isOptimisticTaskId(task.id);

  function set(next: string) {
    if (next === task.statusId) return;
    update.mutate({ id: task.id, statusId: next });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Status: ${label}. Change status`}
        className={cn(
          "group/status inline-flex items-center rounded-full text-xs font-medium whitespace-nowrap",
          "focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
          compact
            ? "h-6 w-6 justify-center text-muted-foreground transition-colors [transition-duration:var(--duration-fast)] hover:bg-accent hover:text-foreground"
            : cn(
                "gap-1 py-0.5 pl-2.5 pr-1.5 transition-[filter] [transition-duration:var(--duration-fast)] hover:brightness-95",
                c.badge,
              ),
          className,
        )}
      >
        {!compact && (
          <>
            <StatusDot status={task.status} color={task.statusColor} />
            {label}
          </>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-3 w-3",
            !compact && "opacity-50 group-hover/status:opacity-100",
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup value={task.statusId} onValueChange={set}>
          {statuses.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              <StatusDot
                status={s.category}
                color={s.color}
                className="mr-1 h-2 w-2"
              />
              {s.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
