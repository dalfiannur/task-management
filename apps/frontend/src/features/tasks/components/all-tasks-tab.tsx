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
import { Plus, SearchX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
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
import { buildHierarchy, edgeConflicts, subtaskProgress } from "../task-graph";
import {
  filterTasks,
  hasActiveFilter,
  parseTaskFilter,
  type TaskFilter,
} from "../filter";
import { ModuleSection } from "./module-section";
import { TaskFilterBar } from "./task-filter-bar";
import { ModuleDialog } from "./module-dialog";
import { TaskDialog } from "./task-dialog";

export function AllTasksTab({ projectId }: { projectId: string }) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authed/projects/$projectId" });
  const { task: taskParam, comment: commentParam } = search;
  // Re-parsed rather than spread: `validateSearch` already normalised these,
  // and going back through the parser keeps the filter object free of the
  // dialog params that share the same search bag.
  const filter = parseTaskFilter(search);
  const filtering = hasActiveFilter(filter);
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

  // A resolved task doesn't necessarily belong to *this* project: GetTask
  // fetches by id alone, and a task moved to another project (MoveTask
  // re-resolves and re-indexes it under its new project) leaves any
  // previously bookmarked/shared URL pointing at a task this project's
  // modules no longer contain. Rendering it anyway would offer this
  // project's labels/members in the dialog while saving onto a task that
  // belongs to a different project's data — silent cross-project
  // corruption, not just a wrong display. `tasks` (and so `taskFromList`)
  // is already project-scoped and can never trip this; only the
  // fetch-fallback path can. Gated on modules having actually loaded, so an
  // empty `modules` mid-fetch doesn't reject every valid deep link.
  const modulesReady = !modulesLoading;
  const crossProjectTask =
    modulesReady &&
    !!editingTask &&
    !modules.some((m) => m.id === editingTask.moduleId);
  // Never hand the mismatched task to the dialog, even for the one render
  // before the effect below closes it — the loading skeleton (task-dialog's
  // `loading` branch) is what's shown instead until it's stripped.
  const safeEditingTask = crossProjectTask ? undefined : editingTask;

  function setTaskSearch(next: { task?: string; comment?: string }) {
    navigate({ to: ".", search: (prev) => ({ ...prev, ...next }) });
  }

  function openTask(id: string) {
    setTaskSearch({ task: id, comment: undefined });
  }

  function closeTaskDialog() {
    setTaskSearch({ task: undefined, comment: undefined });
  }

  function setFilter(next: Partial<TaskFilter>) {
    navigate({ to: ".", search: (prev) => ({ ...prev, ...next }) });
  }

  function clearFilters() {
    setFilter({
      status: undefined,
      priority: undefined,
      assignee: undefined,
      label: undefined,
      from: undefined,
      to: undefined,
    });
  }

  // Deleted task / no access, or a task that's moved to another project
  // since the link was made: either way, tell the user and drop the stale
  // param rather than leaving the dialog stuck open on nothing (or on the
  // wrong project's data).
  useEffect(() => {
    if (needsFetch && taskFetchError) {
      toast.error("Task not found, or you do not have access");
      closeTaskDialog();
      return;
    }
    if (crossProjectTask) {
      toast.error("That task has moved to another project");
      closeTaskDialog();
    }
    // closeTaskDialog intentionally excluded from deps: it calls navigate()
    // with the FUNCTIONAL updater form (`search: (prev) => ...`), which
    // TanStack Router calls with the live search state at navigation time —
    // not a value captured from this render's closure. That's what makes
    // omitting it safe; a rewrite to a static `search: {...}` object would
    // reintroduce the stale-closure risk exhaustive-deps is warning about.
  }, [needsFetch, taskFetchError, crossProjectTask]);

  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    moduleId: string;
  }>({ open: false, moduleId: "" });
  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    module?: Module;
  }>({ open: false });

  // Whether a task is "blocked": any of its blockedByIds resolves to a task
  // that is not done. Reuses edgeConflicts' "status" rule rather than
  // re-deriving it. Dependencies can point at a task in any module of the
  // project, so this is computed over the full project task list, not per
  // module.
  const blockedMap = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const out: Record<string, boolean> = {};
    for (const t of tasks) {
      out[t.id] = t.blockedByIds.some((bId) => {
        const blocker = byId.get(bId);
        return !!blocker && edgeConflicts(blocker, t).includes("status");
      });
    }
    return out;
  }, [tasks]);

  // Destructured so the memo keys off primitives — `filter` itself is a fresh
  // object on every render.
  const { status, priority, assignee, label, from, to } = filter;
  const visibleTasks = useMemo(
    () => filterTasks(tasks, { status, priority, assignee, label, from, to }),
    [tasks, status, priority, assignee, label, from, to],
  );

  // Subtask tallies over the FULL project list, not the filtered one: a
  // parent kept on screen only because one of its children matched would
  // otherwise report `1/1` for a task that really has three subtasks.
  const subtaskStats = useMemo(() => {
    const { roots, childrenOf } = buildHierarchy(tasks);
    const out: Record<string, { done: number; total: number }> = {};
    for (const r of roots) {
      const p = subtaskProgress(r, childrenOf);
      if (p) out[r.id] = p;
    }
    return out;
  }, [tasks]);

  const tasksByModule = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const m of modules) map[m.id] = [];
    for (const t of visibleTasks) (map[t.moduleId] ??= []).push(t);
    for (const id of Object.keys(map)) {
      map[id].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [modules, visibleTasks]);

  // Unfiltered counts, kept alongside: a module's delete confirmation has to
  // name how many tasks really go with it, not how many happen to be on
  // screen right now.
  const totalByModule = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tasks) map[t.moduleId] = (map[t.moduleId] ?? 0) + 1;
    return map;
  }, [tasks]);

  // A module with nothing left to show is noise while filtering, but it is
  // still a real (and droppable) module when no filter is on.
  const visibleModules = filtering
    ? modules.filter((m) => (tasksByModule[m.id]?.length ?? 0) > 0)
    : modules;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    // Belt to the `dragDisabled` braces on the rows: `targetIndex` below is
    // read off the rendered (filtered) list, so a drop while filtering would
    // write an `order` computed against a list the backend has never seen.
    if (filtering) return;
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
      {modules.length > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <TaskFilterBar
            filter={filter}
            onChange={setFilter}
            onClear={clearFilters}
            memberIds={memberIds}
            userMap={userMap}
            labelMap={labelMap}
            matched={visibleTasks.length}
            total={tasks.length}
          />
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModuleDialog({ open: true })}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add module
            </Button>
          )}
        </div>
      )}

      {modules.length === 0 ? (
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
          {canManage
            ? "No modules yet. Add one to start organizing tasks."
            : "No modules yet."}
        </div>
      ) : visibleModules.length === 0 ? (
        // Only reachable while filtering — `visibleModules` is `modules`
        // otherwise. The way out of an over-narrow filter is to widen it, so
        // that is the one CTA (empty-states.md §4, `no-results`).
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title="No tasks match these filters"
          body="Nothing in this project fits every filter at once. Clear them to see the full task list again."
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="space-y-4">
            {visibleModules.map((m) => {
              // Position in the FULL module list: the reorder arrows move a
              // module among all of them, so an index into the filtered list
              // would swap the wrong pair.
              const i = modules.indexOf(m);
              return (
                <ModuleSection
                  key={m.id}
                  projectId={projectId}
                  module={m}
                  tasks={tasksByModule[m.id] ?? []}
                  totalCount={totalByModule[m.id] ?? 0}
                  canManage={canManage}
                  dragDisabled={filtering}
                  userMap={userMap}
                  labelMap={labelMap}
                  blockedMap={blockedMap}
                  subtaskStats={subtaskStats}
                  onEditTask={(task) => openTask(task.id)}
                  onEditModule={(module) =>
                    setModuleDialog({ open: true, module })
                  }
                  onMoveUp={() => moveModule(i, -1)}
                  onMoveDown={() => moveModule(i, 1)}
                  isFirst={i === 0}
                  isLast={i === modules.length - 1}
                />
              );
            })}
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
        moduleId={safeEditingTask?.moduleId ?? ""}
        task={safeEditingTask}
        editing={!!taskParam}
        highlightCommentId={commentParam}
        memberIds={memberIds}
        userMap={userMap}
        tasks={tasks}
        onOpenTask={openTask}
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
        tasks={tasks}
        onOpenTask={openTask}
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
