import { Ban, Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Task } from "../types";
import { edgeConflicts } from "../task-graph";
import { StatusBadge } from "./task-badges";

/**
 * "Blocked by" multi-select over the project's other tasks (finish-to-start
 * dependencies). Follows LabelCombobox's controlled-popover interaction
 * pattern: selection lives in `task.blockedByIds`, toggling reports the next
 * full array via `onChange` — the caller owns the mutation, same split as
 * every other quick-edit in this dialog.
 */
export function DependencyPicker({
  task,
  candidates,
  onChange,
}: {
  task: Task;
  /** The project's other tasks, already excluding `task` and its subtasks. */
  candidates: Task[];
  onChange: (blockedByIds: string[]) => void;
}) {
  const selected = task.blockedByIds;

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((v) => v !== id)
        : [...selected, id],
    );
  }

  const selectedTasks = selected
    .map((id) => candidates.find((c) => c.id === id))
    .filter((c): c is Task => !!c);

  return (
    <div className="space-y-2">
      <Label>Blocked by</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-start"
          >
            <Ban className="mr-1 h-4 w-4" />
            {selected.length ? `${selected.length} task(s)` : "None"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1" align="start">
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {candidates.length === 0 ? (
              <li className="p-2 text-sm text-text-muted">
                No other tasks in this project.
              </li>
            ) : (
              candidates.map((c) => {
                const isSelected = selected.includes(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
                    >
                      <span className="flex-1 truncate text-left">
                        {c.title}
                      </span>
                      <StatusBadge status={c.status} />
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverContent>
      </Popover>
      {selectedTasks.length > 0 && (
        <ul className="space-y-1">
          {selectedTasks.map((b) => {
            const conflicts = edgeConflicts(b, task);
            const conflicted = conflicts.length > 0;
            return (
              <li
                key={b.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                  conflicted ? "bg-danger-subtle text-danger" : "text-text-muted",
                )}
              >
                {conflicted && <TriangleAlert className="h-4 w-4 shrink-0" />}
                <span className="flex-1 truncate">{b.title}</span>
                <StatusBadge status={b.status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
