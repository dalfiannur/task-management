import { useState } from "react";
import { useAtomValue } from "jotai";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "sedjiwa-ui";
import { formatMinutes } from "@/lib/duration";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import type { Module } from "../types";
import {
  useCreateTaskFromTemplate,
  useDeleteTaskTemplate,
  useTaskTemplates,
  type TaskTemplate,
} from "../api/templates";

/**
 * The project's task templates: create a task (with its subtasks) from one,
 * or delete one. Templates are saved from a task's dialog.
 */
export function TaskTemplatesDialog({
  projectId,
  projectOwnerId,
  modules,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  projectOwnerId?: string;
  modules: Module[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the new task. */
  onCreated: (taskId: string) => void;
}) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { templates, isLoading } = useTaskTemplates(projectId, open);
  const create = useCreateTaskFromTemplate();
  const del = useDeleteTaskTemplate();
  const [moduleId, setModuleId] = useState("");
  const target = moduleId || modules[0]?.id || "";

  const canDelete = (t: TaskTemplate) =>
    isAdmin || t.createdBy === me?.id || projectOwnerId === me?.id;

  function use(t: TaskTemplate) {
    create.mutate(
      { templateId: t.id, moduleId: target },
      {
        onSuccess: (task) => {
          toast.success(`Task created from "${t.name}".`);
          onOpenChange(false);
          onCreated(task.id);
        },
        onError: (err) => toast.error(err.message || "Failed to create the task"),
      },
    );
  }

  function remove(t: TaskTemplate) {
    del.mutate(
      { id: t.id },
      {
        onSuccess: () => toast.success(`Template "${t.name}" deleted.`),
        onError: (err) => toast.error(err.message || "Delete failed"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Task templates</DialogTitle>
          <DialogDescription>
            Start a task with its description, estimate, labels and subtasks filled
            in. Save a template from any task's dialog.
          </DialogDescription>
        </DialogHeader>

        {modules.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Add to</span>
            <Select value={target} onValueChange={setModuleId}>
              <SelectTrigger className="h-8 w-56" aria-label="Module">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <LayoutTemplate className="h-5 w-5" aria-hidden="true" />
            No templates yet. Open a task and choose “Save as template”.
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-num truncate text-xs text-muted-foreground">
                    {t.title}
                    {t.subtasks.length > 0 &&
                      ` · ${t.subtasks.length} subtask${t.subtasks.length === 1 ? "" : "s"}`}
                    {t.estimateMinutes ? ` · ${formatMinutes(t.estimateMinutes)}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={create.isPending || !target}
                  onClick={() => use(t)}
                >
                  Use
                </Button>
                {canDelete(t) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={del.isPending}
                    aria-label={`Delete template ${t.name}`}
                    onClick={() => remove(t)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
