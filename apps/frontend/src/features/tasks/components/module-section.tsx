import { Fragment, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { AppUser } from "@/features/auth";
import type { Label } from "@/features/labels";
import type { Module, Task } from "../types";
import { useModuleCollapsed } from "../atoms/collapsed-modules";
import { useCreateTask, useDeleteModule } from "../api/hooks";
import { buildHierarchy } from "../task-graph";
import type { ModuleStats } from "../task-stats";
import { TaskListHeader, TaskRow } from "./task-row";

export function ModuleSection({
  projectId,
  module,
  tasks,
  totalCount,
  stats,
  canManage,
  dragDisabled,
  userMap,
  labelMap,
  blockedMap,
  subtaskStats,
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
  /** The tasks to render — already filtered by the Tasks-tab filter bar. */
  tasks: Task[];
  /** How many tasks this module really holds, filter or no filter. */
  totalCount: number;
  /** Done/total/overdue over the module's unfiltered tasks. */
  stats: ModuleStats;
  canManage: boolean;
  /** Set while a filter is on: the rendered order is not the stored order. */
  dragDisabled: boolean;
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  /** taskId → whether a `blockedByIds` entry resolves to a not-done task. */
  blockedMap: Record<string, boolean>;
  /** taskId → its real subtask tally, counted over the unfiltered list. */
  subtaskStats: Record<string, { done: number; total: number }>;
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
  const [collapsed, setCollapsed] = useModuleCollapsed(projectId, module.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

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
    // `asChild` supaya Collapsible tidak menambah elemen pembungkus dan
    // `<section>` tetap jadi kotak kartu yang sama seperti sebelumnya.
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      asChild
    >
      {/* Droppable-nya ada di `<section>`, bukan di daftar task, supaya module
          tetap jadi tujuan drag saat terlipat — kalau tidak, melipat sebuah
          module diam-diam menghapusnya sebagai tujuan pemindahan task. */}
      <section
        ref={setNodeRef}
        className="overflow-hidden rounded-xl bg-surface-raised shadow-2"
      >
        <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1.5 h-7 w-7 shrink-0 [&[data-state=open]>svg]:rotate-90"
              aria-label={`Toggle ${module.name}`}
            >
              <ChevronRight className="h-4 w-4 transition-transform" />
            </Button>
          </CollapsibleTrigger>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="truncate font-semibold">{module.name}</h3>
            <span className="text-num rounded-full bg-surface-sunken px-2 text-xs text-text-muted">
              {tasks.length === totalCount
                ? totalCount
                : `${tasks.length} / ${totalCount}`}
            </span>
            {stats.overdue > 0 && (
              <span className="text-xs font-medium text-danger">
                <span className="text-num">{stats.overdue}</span> overdue
              </span>
            )}
          </div>
          {stats.total > 0 && (
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`${module.name}: tasks done`}
                className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    pct === 100 ? "bg-success" : "bg-brand",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-num min-w-[5.5rem] whitespace-nowrap text-xs text-text-muted">
                {stats.done}/{stats.total} · {pct}%
              </span>
            </div>
          )}
          {canManage && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={`${module.name} actions`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEditModule(module)}>
                    <Pencil className="h-4 w-4" />
                    Edit module
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isFirst} onSelect={onMoveUp}>
                    <ChevronUp className="h-4 w-4" />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isLast} onSelect={onMoveDown}>
                    <ChevronDown className="h-4 w-4" />
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete module
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Controlled from the menu item: an AlertDialogTrigger inside
                  the menu would unmount with it the moment the menu closes. */}
              <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{module.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes the module and its {totalCount} task(s). This
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
            </>
          )}
        </header>

        <CollapsibleContent>
          <div className="min-h-[0.5rem]">
            {tasks.length > 0 && <TaskListHeader />}
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              {roots.map((task) => (
                <Fragment key={task.id}>
                  <TaskRow
                    projectId={projectId}
                    task={task}
                    userMap={userMap}
                    labelMap={labelMap}
                    onEdit={onEditTask}
                    dragDisabled={dragDisabled}
                    progress={subtaskStats[task.id] ?? null}
                    blocked={blockedMap[task.id]}
                    subtaskCount={subtaskStats[task.id]?.total ?? 0}
                  />
                  {(childrenOf[task.id] ?? []).map((child) => (
                    <TaskRow
                      key={child.id}
                      projectId={projectId}
                      task={child}
                      userMap={userMap}
                      labelMap={labelMap}
                      onEdit={onEditTask}
                      dragDisabled={dragDisabled}
                      depth={1}
                      blocked={blockedMap[child.id]}
                    />
                  ))}
                </Fragment>
              ))}
            </SortableContext>
            {/* Reachable only unfiltered: a module the filter empties is
                dropped from the list upstream, never rendered hollow. */}
            {tasks.length === 0 && (
              <p className="px-4 py-3 text-sm text-text-muted">No tasks yet.</p>
            )}
          </div>

          <form
            onSubmit={addTask}
            className="flex items-center gap-2 border-t border-border-subtle px-4 py-2"
          >
            <Plus className="h-4 w-4 shrink-0 text-text-muted" />
            <Input
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              placeholder="Add a task…"
              aria-label={`Add a task to ${module.name}`}
              /* `!` beats the Input module's own border/padding shorthand. */
              className="!h-8 !border-0 !bg-transparent !px-0 !shadow-none !outline-none focus-visible:ring-0"
            />
          </form>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
