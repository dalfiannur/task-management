import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import { LabelChips, type Label } from "@/features/labels";
import type { Task } from "../types";
import { statusToProto } from "../api/mappers";
import { useUpdateTask, useDeleteTask } from "../api/hooks";
import { StatusBadge, PriorityLabel } from "./task-badges";
import { AssigneeAvatars } from "./assignee-picker";

export function TaskRow({
  task,
  userMap,
  labelMap,
  onEdit,
  depth = 0,
  progress,
  blocked,
  subtaskCount = 0,
}: {
  task: Task;
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  onEdit: (task: Task) => void;
  /** 0 = top-level, 1 = subtask (subtasks go one level deep only). */
  depth?: number;
  /** `{ done, total }` for a parent with subtasks — null/omitted otherwise. */
  progress?: { done: number; total: number } | null;
  /** True when a `blockedByIds` entry resolves to a not-done task. */
  blocked?: boolean;
  /**
   * Number of subtasks this task has (always 0 for a subtask itself — the
   * one-level rule means it can't have any). Above zero, delete goes through
   * a confirmation naming the count instead of the one-click delete a
   * childless task still gets — deleting a parent now takes its subtree
   * with it, so the blast radius grew and the guard has to grow with it.
   */
  subtaskCount?: number;
}) {
  const update = useUpdateTask();
  const del = useDeleteTask();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const done = task.status === "done";

  function toggleDone(checked: boolean) {
    update.mutate(
      { id: task.id, status: statusToProto(checked ? "done" : "todo") },
      { onError: (e) => toast.error(e.message || "Failed to update") },
    );
  }

  function onDelete(e: React.MouseEvent) {
    e.stopPropagation();
    del.mutate(
      { id: task.id },
      {
        onSuccess: () => toast.success("Task deleted."),
        onError: (e2) => toast.error(e2.message || "Delete failed"),
      },
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 border-b border-border-subtle py-3 last:border-b-0",
        // Subtasks (depth 1) get one extra indent step (24px, `pl-6`) on top
        // of the row's own 16px inset — pl-10 is that sum. Subtasks go one
        // level deep only, so this never needs to compound further.
        depth ? "pl-10 pr-4" : "px-4",
        "transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        className="cursor-grab text-text-muted/40 hover:text-text-muted"
        {...attributes}
        {...listeners}
        aria-label="Drag task"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        checked={done}
        onCheckedChange={(c) => toggleDone(c === true)}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={() => onEdit(task)}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <span
          className={cn(
            "flex-1 truncate text-sm",
            done && "text-text-muted line-through",
          )}
        >
          {task.title}
        </span>
        {progress && (
          <span className="text-num text-xs text-text-muted">
            {progress.done}/{progress.total}
          </span>
        )}
        <LabelChips ids={task.labelIds} labelMap={labelMap} max={2} />
        <PriorityLabel priority={task.priority} />
        {task.dueDate && (
          <span className="text-num text-xs text-text-muted">
            {task.dueDate}
          </span>
        )}
        <AssigneeAvatars ids={task.assigneeIds} userMap={userMap} />
        <StatusBadge status={task.status} />
      </button>
      {blocked && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          className="inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-medium text-danger transition-colors [transition-duration:var(--duration-fast)] hover:opacity-80"
        >
          Blocked
        </button>
      )}
      {subtaskCount > 0 ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => e.stopPropagation()}
              aria-label="Delete task"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{task.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes this task and its {subtaskCount}{" "}
                subtask{subtaskCount === 1 ? "" : "s"}. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
