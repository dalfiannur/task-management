import { Fragment, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { AppUser } from "@/features/auth";
import type { Label } from "@/features/labels";
import type { Module, Task } from "../types";
import { useCreateTask, useDeleteModule } from "../api/hooks";
import { buildHierarchy, subtaskProgress } from "../task-graph";
import { TaskRow } from "./task-row";

export function ModuleSection({
  projectId,
  module,
  tasks,
  canManage,
  userMap,
  labelMap,
  blockedMap,
  onEditTask,
  onEditModule,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  /** The project whose task list the optimistic quick-add writes into. */
  projectId: string;
  module: Module;
  tasks: Task[];
  canManage: boolean;
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  /** taskId → whether a `blockedByIds` entry resolves to a not-done task. */
  blockedMap: Record<string, boolean>;
  onEditTask: (task: Task) => void;
  onEditModule: (module: Module) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const create = useCreateTask(projectId);
  const del = useDeleteModule();
  const [quick, setQuick] = useState("");
  const { setNodeRef } = useDroppable({ id: `mod:${module.id}` });

  // Parent and children always share a module (the backend enforces it), so
  // hierarchy can be built from this module's own task slice.
  const { roots, childrenOf } = buildHierarchy(tasks);
  // Sortable items in the same order they're rendered (root, its children,
  // next root, …) — one flat SortableContext, not a nested one. Dragging a
  // subtask between parents is out of scope; this only lets rows reorder
  // within the existing flat drag mechanics.
  const orderedIds = roots.flatMap((r) => [
    r.id,
    ...(childrenOf[r.id] ?? []).map((c) => c.id),
  ]);

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    // Cleared up front, not on success — the row is already on screen, so
    // the field is free for the next task.
    setQuick("");
    // Failure is reported (and the placeholder row removed) by useCreateTask.
    create.mutate({ moduleId: module.id, title, assigneeIds: [], labelIds: [] });
  }

  function deleteModule() {
    del.mutate(
      { id: module.id },
      {
        onSuccess: () => toast.success("Module deleted."),
        onError: (err) => toast.error(err.message || "Delete failed"),
      },
    );
  }

  return (
    <section className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <h3 className="font-medium">{module.name}</h3>
        <span className="text-num text-xs text-text-muted">{tasks.length}</span>
        <div className="flex-1" />
        {canManage && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={isFirst}
              onClick={onMoveUp}
              aria-label="Move module up"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={isLast}
              onClick={onMoveDown}
              aria-label="Move module down"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEditModule(module)}
              aria-label="Edit module"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Delete module"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{module.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the module and its {tasks.length} task(s). This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteModule}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </header>

      <div ref={setNodeRef} className="min-h-[0.5rem]">
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          {roots.map((task) => (
            <Fragment key={task.id}>
              <TaskRow
                projectId={projectId}
                task={task}
                userMap={userMap}
                labelMap={labelMap}
                onEdit={onEditTask}
                progress={subtaskProgress(task, childrenOf)}
                blocked={blockedMap[task.id]}
                subtaskCount={(childrenOf[task.id] ?? []).length}
              />
              {(childrenOf[task.id] ?? []).map((child) => (
                <TaskRow
                  key={child.id}
                  projectId={projectId}
                  task={child}
                  userMap={userMap}
                  labelMap={labelMap}
                  onEdit={onEditTask}
                  depth={1}
                  blocked={blockedMap[child.id]}
                />
              ))}
            </Fragment>
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="px-4 py-3 text-sm text-text-muted">No tasks yet.</p>
        )}
      </div>

      <form
        onSubmit={addTask}
        className="flex items-center gap-2 border-t border-border-subtle px-4 py-2"
      >
        <Plus className="h-4 w-4 text-text-muted" />
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Add a task…"
          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </form>
    </section>
  );
}
