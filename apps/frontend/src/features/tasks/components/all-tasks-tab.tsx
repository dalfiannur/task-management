import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useProject, useProjectMembers } from "@/features/projects";
import { useUserMap } from "@/features/users";
import { useLabelMap } from "@/features/labels";
import type { Module, Task } from "../types";
import {
  useModules,
  useTasks,
  useTask,
  useMoveTask,
  useReorderModules,
} from "../api/hooks";
import { ModuleSection } from "./module-section";
import { ModuleDialog } from "./module-dialog";
import { TaskDialog } from "./task-dialog";

export function AllTasksTab({ projectId }: { projectId: string }) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const navigate = useNavigate();
  const { task: taskParam, comment: commentParam } = useSearch({
    from: "/_authed/projects/$projectId",
  });
  const { project } = useProject(projectId);
  const { modules, isLoading: modulesLoading } = useModules(projectId);
  const { tasks, isLoading: tasksLoading } = useTasks(projectId);
  const { memberIds } = useProjectMembers(projectId);
  const userMap = useUserMap();
  const labelMap = useLabelMap(projectId);
  const move = useMoveTask();
  const reorder = useReorderModules();

  const canManage = isAdmin || (!!project && project.ownerId === me?.id);

  // Resolve the URL-addressed task from the already-loaded list first (a warm
  // click never waits on a round-trip); fall back to a direct fetch so a cold
  // deep link still works.
  const taskFromList = taskParam
    ? tasks.find((t) => t.id === taskParam)
    : undefined;
  const needsFetch = !!taskParam && !taskFromList;
  const { task: fetchedTask, isError: taskFetchError } = useTask(
    needsFetch ? taskParam : undefined,
  );
  const editingTask = taskFromList ?? fetchedTask;

  function setTaskSearch(next: { task?: string; comment?: string }) {
    navigate({ to: ".", search: (prev) => ({ ...prev, ...next }) });
  }

  function openTask(id: string) {
    setTaskSearch({ task: id, comment: undefined });
  }

  function closeTaskDialog() {
    setTaskSearch({ task: undefined, comment: undefined });
  }

  // Deleted task, or one the caller can't see: tell the user and drop the
  // stale param rather than leaving the dialog stuck open on nothing.
  useEffect(() => {
    if (needsFetch && taskFetchError) {
      toast.error("Task not found, or you do not have access");
      closeTaskDialog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFetch, taskFetchError]);

  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    moduleId: string;
  }>({ open: false, moduleId: "" });
  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    module?: Module;
  }>({ open: false });

  const tasksByModule = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const m of modules) map[m.id] = [];
    for (const t of tasks) (map[t.moduleId] ??= []).push(t);
    for (const id of Object.keys(map)) {
      map[id].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [modules, tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = String(over.id);
    let targetModuleId: string;
    let targetIndex: number;
    if (overId.startsWith("mod:")) {
      targetModuleId = overId.slice(4);
      targetIndex = tasksByModule[targetModuleId]?.length ?? 0;
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) return;
      targetModuleId = overTask.moduleId;
      targetIndex = (tasksByModule[targetModuleId] ?? []).findIndex(
        (t) => t.id === overTask.id,
      );
    }
    if (
      targetModuleId === activeTask.moduleId &&
      targetIndex === activeTask.order
    ) {
      return;
    }
    move.mutate(
      { id: activeTask.id, moduleId: targetModuleId, order: targetIndex },
      { onError: (err) => toast.error(err.message || "Move failed") },
    );
  }

  function moveModule(index: number, dir: -1 | 1) {
    const ids = modules.map((m) => m.id);
    const swap = index + dir;
    if (swap < 0 || swap >= ids.length) return;
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    reorder.mutate(
      { projectId, moduleIds: ids },
      { onError: (err) => toast.error(err.message || "Reorder failed") },
    );
  }

  if (modulesLoading || tasksLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-24 w-full rounded-xl shadow-2" />
        <Skeleton className="h-24 w-full rounded-xl shadow-2" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModuleDialog({ open: true })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add module
          </Button>
        </div>
      )}

      {modules.length === 0 ? (
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
          {canManage
            ? "No modules yet. Add one to start organizing tasks."
            : "No modules yet."}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="space-y-4">
            {modules.map((m, i) => (
              <ModuleSection
                key={m.id}
                module={m}
                tasks={tasksByModule[m.id] ?? []}
                canManage={canManage}
                userMap={userMap}
                labelMap={labelMap}
                onEditTask={(task) => openTask(task.id)}
                onEditModule={(module) => setModuleDialog({ open: true, module })}
                onMoveUp={() => moveModule(i, -1)}
                onMoveDown={() => moveModule(i, 1)}
                isFirst={i === 0}
                isLast={i === modules.length - 1}
              />
            ))}
          </div>
        </DndContext>
      )}

      {/* URL-driven edit dialog: `open` follows the `task` search param
          directly rather than local state, so Back/forward and a pasted
          link both work. */}
      <TaskDialog
        open={!!taskParam}
        onOpenChange={(open) => {
          if (!open) closeTaskDialog();
        }}
        projectId={projectId}
        moduleId={editingTask?.moduleId ?? ""}
        task={editingTask}
        highlightCommentId={commentParam}
        memberIds={memberIds}
        userMap={userMap}
      />
      {/* Create dialog stays on local state — a task being created has no id
          yet, so there's nothing to address. */}
      <TaskDialog
        open={createDialog.open}
        onOpenChange={(open) =>
          setCreateDialog((s) => ({ ...s, open }))
        }
        projectId={projectId}
        moduleId={createDialog.moduleId}
        memberIds={memberIds}
        userMap={userMap}
      />
      <ModuleDialog
        open={moduleDialog.open}
        onOpenChange={(open) => setModuleDialog((s) => ({ ...s, open }))}
        projectId={projectId}
        module={moduleDialog.module}
      />
    </div>
  );
}
