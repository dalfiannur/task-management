import { useState } from "react";
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
import type { Module, Task } from "../types";
import { useCreateTask, useDeleteModule } from "../api/hooks";
import { TaskRow } from "./task-row";

export function ModuleSection({
  module,
  tasks,
  canManage,
  userMap,
  onEditTask,
  onEditModule,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  module: Module;
  tasks: Task[];
  canManage: boolean;
  userMap: Record<string, AppUser>;
  onEditTask: (task: Task) => void;
  onEditModule: (module: Module) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const create = useCreateTask();
  const del = useDeleteModule();
  const [quick, setQuick] = useState("");
  const { setNodeRef } = useDroppable({ id: `mod:${module.id}` });

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    create.mutate(
      { moduleId: module.id, title, assigneeIds: [], labelIds: [] },
      {
        onSuccess: () => setQuick(""),
        onError: (err) => toast.error(err.message || "Failed to add task"),
      },
    );
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
    <section className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="font-medium">{module.name}</h3>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
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

      <div ref={setNodeRef} className="min-h-[0.5rem] px-2 py-1">
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              userMap={userMap}
              onEdit={onEditTask}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">No tasks yet.</p>
        )}
      </div>

      <form onSubmit={addTask} className="flex items-center gap-2 border-t px-3 py-2">
        <Plus className="h-4 w-4 text-muted-foreground" />
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
