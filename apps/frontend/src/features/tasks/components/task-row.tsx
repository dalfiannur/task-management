import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import type { Task } from "../types";
import { statusToProto } from "../api/mappers";
import { useUpdateTask, useDeleteTask } from "../api/hooks";
import { StatusBadge, PriorityLabel } from "./task-badges";
import { AssigneeAvatars } from "./assignee-picker";

export function TaskRow({
  task,
  userMap,
  onEdit,
}: {
  task: Task;
  userMap: Record<string, AppUser>;
  onEdit: (task: Task) => void;
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
        "group flex items-center gap-2 rounded-md border-b px-2 py-2 last:border-b-0 hover:bg-muted/40",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground"
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
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <PriorityLabel priority={task.priority} />
        {task.dueDate && (
          <span className="text-xs text-muted-foreground">{task.dueDate}</span>
        )}
        <AssigneeAvatars ids={task.assigneeIds} userMap={userMap} />
        <StatusBadge status={task.status} />
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100"
        onClick={onDelete}
        aria-label="Delete task"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
