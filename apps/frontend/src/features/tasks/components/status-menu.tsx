import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type Task, type TaskStatus } from "../types";
import { TASK_STATUS_CONFIG } from "../config";
import { statusToProto } from "../api/mappers";
import { isOptimisticTaskId, useUpdateTask } from "../api/hooks";

/**
 * The status badge, as a menu: change a task's status without opening the
 * dialog. Optimistic through `useUpdateTask`, which also reports a failure
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
  const c = TASK_STATUS_CONFIG[task.status];
  // No server id yet — nothing to send the change to.
  const pending = isOptimisticTaskId(task.id);

  function set(next: string) {
    if (next === task.status) return;
    update.mutate({ id: task.id, status: statusToProto(next as TaskStatus) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Status: ${c.label}. Change status`}
        className={cn(
          "group/status inline-flex items-center rounded-full text-xs font-medium whitespace-nowrap",
          "focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60",
          compact
            ? "h-6 w-6 justify-center text-text-muted transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover hover:text-text"
            : cn(
                "gap-1 py-0.5 pl-2.5 pr-1.5 transition-[filter] [transition-duration:var(--duration-fast)] hover:brightness-95",
                c.badge,
              ),
          className,
        )}
      >
        {!compact && (
          <>
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 rounded-full", c.dot)}
            />
            {c.label}
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
        <DropdownMenuRadioGroup value={task.status} onValueChange={set}>
          {TASK_STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              <span
                aria-hidden="true"
                className={cn(
                  "mr-1 inline-block h-2 w-2 rounded-full",
                  TASK_STATUS_CONFIG[s].dot,
                )}
              />
              {TASK_STATUS_CONFIG[s].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
