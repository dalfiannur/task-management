import { useState } from "react";
import { Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Task } from "../types";
import { statusToProto } from "../api/mappers";
import { isOptimisticTaskId, useCreateTask, useUpdateTask } from "../api/hooks";
import { StatusBadge } from "./task-badges";

/**
 * The parent's subtasks, with an inline quick-add. Only meaningful for a task
 * that is not itself a subtask — the one-level rule means a subtask can never
 * have children, so the caller must not render this for one (it shows a link
 * back to the parent instead; see task-dialog.tsx).
 */
export function SubtaskSection({
  projectId,
  parent,
  children,
  onOpenTask,
}: {
  /** The project whose task list the optimistic quick-add writes into. */
  projectId: string;
  parent: Task;
  /** Already sorted by `order` — from buildHierarchy's childrenOf. */
  children: Task[];
  /** Opens a subtask in the URL-addressed dialog (`?task=`). */
  onOpenTask: (id: string) => void;
}) {
  const create = useCreateTask(projectId);
  const update = useUpdateTask(projectId);
  const [quick, setQuick] = useState("");

  function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    // Cleared up front, not on success — the row is already on screen, so
    // the field is free for the next subtask.
    setQuick("");
    // Failure is reported (and the placeholder row removed) by useCreateTask.
    create.mutate({
      moduleId: parent.moduleId,
      parentId: parent.id,
      title,
      assigneeIds: [],
      labelIds: [],
    });
  }

  function toggleDone(subtask: Task, checked: boolean) {
    // Failure is reported (and the row reverted) by useUpdateTask.
    update.mutate({
      id: subtask.id,
      status: statusToProto(checked ? "done" : "todo"),
    });
  }

  return (
    <div className="space-y-2">
      <Label>
        Subtasks
        {children.length > 0 && (
          <span className="ml-1 text-num text-text-muted">
            {children.filter((c) => c.status === "done").length}/
            {children.length}
          </span>
        )}
      </Label>
      {children.length > 0 && (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {children.map((c) => {
            const done = c.status === "done";
            // Optimistic row — no server id to update or open yet.
            const pending = isOptimisticTaskId(c.id);
            return (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <Checkbox
                  checked={done}
                  disabled={pending}
                  onCheckedChange={(checked) => toggleDone(c, checked === true)}
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onOpenTask(c.id)}
                  className={cn(
                    "flex-1 truncate text-left text-sm",
                    done && "text-text-muted line-through",
                    pending && "opacity-60",
                  )}
                >
                  {c.title}
                </button>
                <StatusBadge status={c.status} />
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={addSubtask} className="flex items-center gap-2">
        <Plus className="h-4 w-4 shrink-0 text-text-muted" />
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Add a subtask…"
          className="h-8"
        />
      </form>
    </div>
  );
}
