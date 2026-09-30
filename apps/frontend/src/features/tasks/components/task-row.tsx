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
import { isOptimisticTaskId, useUpdateTask, useDeleteTask } from "../api/hooks";
import { DueDate, PriorityLabel } from "./task-badges";
import { StatusMenu } from "./status-menu";
import { AssigneeAvatars } from "./assignee-picker";

export function TaskRow({
  projectId,
  task,
  userMap,
  labelMap,
  onEdit,
  dragDisabled = false,
  depth = 0,
  progress,
  blocked,
  subtaskCount = 0,
}: {
  /** The project whose task list an optimistic edit writes into. */
  projectId: string;
  task: Task;
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  onEdit: (task: Task) => void;
  /**
   * Set while the list is filtered. The rendered order is then a subset of
   * the stored order, so a drop would compute its target index against rows
   * the backend has never seen — the grip goes inert rather than writing a
   * wrong `order`.
   */
  dragDisabled?: boolean;
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
  const update = useUpdateTask(projectId);
  const del = useDeleteTask();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: dragDisabled });

  const done = task.status === "done";
  // Optimistically inserted row: it has no server id yet, so every action
  // that would send one (toggle, edit, delete, drag) stays inert until the
  // real task replaces it — a round-trip later, at most.
  const pending = isOptimisticTaskId(task.id);

  function toggleDone(checked: boolean) {
    // Failure is reported (and the row reverted) by useUpdateTask.
    update.mutate({
      id: task.id,
      status: statusToProto(checked ? "done" : "todo"),
    });
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
        "group relative flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-b-0",
        // Subtasks (depth 1) get one extra indent step (24px, `pl-6`) on top
        // of the row's own 16px inset — pl-10 is that sum. Subtasks go one
        // level deep only, so this never needs to compound further.
        depth ? "pl-10 pr-4" : "px-4",
        "transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover",
        isDragging && "z-20 bg-surface-raised opacity-80 shadow-2",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        disabled={pending || dragDisabled}
        className="relative z-10 -mx-1 cursor-grab text-text-muted/40 hover:text-text-muted disabled:cursor-default disabled:opacity-50"
        {...attributes}
        {...listeners}
        aria-label={
          dragDisabled ? "Reordering is off while filtered" : "Drag task"
        }
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        checked={done}
        disabled={pending}
        onCheckedChange={(c) => toggleDone(c === true)}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10"
        aria-label={done ? "Mark as to do" : "Mark as done"}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {/* Stretched over the whole row (`after:inset-0`), so a click
              anywhere that isn't another control opens the task. Every other
              control sits above it on `z-10`. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => onEdit(task)}
            className={cn(
              "min-w-0 line-clamp-2 text-left text-sm outline-none md:line-clamp-1",
              "after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus",
              depth ? "text-text-muted" : "font-medium text-text",
              done && "text-text-muted line-through",
            )}
          >
            {task.title}
          </button>
          {progress && (
            <span
              className="text-num shrink-0 rounded-full bg-surface-sunken px-1.5 text-xs text-text-muted"
              title="Subtasks done"
            >
              {progress.done}/{progress.total}
            </span>
          )}
          {blocked && (
            <span className="shrink-0 rounded-full bg-danger-subtle px-2 py-0.5 text-xs font-medium text-danger">
              Blocked
            </span>
          )}
          <span className="hidden shrink-0 lg:inline-flex">
            <LabelChips ids={task.labelIds} labelMap={labelMap} max={2} />
          </span>
        </div>
        {/* Below md the columns fold under the title. */}
        {(task.dueDate || task.priority !== "none" || task.assigneeIds.length > 0) && (
          <div className="mt-1 flex items-center gap-3 md:hidden">
            <DueDate task={task} />
            <PriorityLabel priority={task.priority} />
            <AssigneeAvatars ids={task.assigneeIds} userMap={userMap} />
          </div>
        )}
      </div>

      <div className={cn(TASK_COLS.assignee, "hidden md:flex")}>
        <AssigneeAvatars ids={task.assigneeIds} userMap={userMap} />
      </div>
      <div className={cn(TASK_COLS.due, "hidden md:block")}>
        <DueDate task={task} />
      </div>
      <div className={cn(TASK_COLS.priority, "hidden md:block")}>
        {task.priority === "none" ? (
          <span className="text-xs text-text-subtle">—</span>
        ) : (
          <PriorityLabel priority={task.priority} />
        )}
      </div>
      <div className={cn(TASK_COLS.status, "relative z-10 flex")}>
        <StatusMenu projectId={projectId} task={task} />
      </div>
      {subtaskCount > 0 ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              className="relative z-10 h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
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
          disabled={pending}
          className="relative z-10 h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={onDelete}
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/** Fixed widths shared by the row cells and the column header above them. */
const TASK_COLS = {
  assignee: "w-20 shrink-0",
  due: "w-24 shrink-0",
  priority: "w-16 shrink-0",
  status: "shrink-0 justify-start md:w-32",
  actions: "w-7 shrink-0",
};

/** Column captions for a module's task list — md and up, where the columns
 *  exist. The leading spacer stands in for the grip and the checkbox. */
export function TaskListHeader() {
  return (
    <div
      aria-hidden="true"
      className="hidden items-center gap-3 border-b border-border-subtle bg-surface-sunken/40 px-4 py-1.5 text-label md:flex"
    >
      <span className="w-[2.25rem] shrink-0" />
      <span className="flex-1">Task</span>
      <span className={TASK_COLS.assignee}>Assignee</span>
      <span className={TASK_COLS.due}>Due</span>
      <span className={TASK_COLS.priority}>Priority</span>
      <span className={TASK_COLS.status}>Status</span>
      <span className={TASK_COLS.actions} />
    </div>
  );
}
