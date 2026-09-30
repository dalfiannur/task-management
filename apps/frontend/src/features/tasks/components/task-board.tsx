import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import { LabelChips, type Label } from "@/features/labels";
import { TASK_STATUSES, type Module, type Task, type TaskStatus } from "../types";
import { TASK_STATUS_CONFIG } from "../config";
import { statusToProto } from "../api/mappers";
import { isOptimisticTaskId, useUpdateTask } from "../api/hooks";
import { AssigneeAvatars } from "./assignee-picker";
import { DueDate, PriorityLabel } from "./task-badges";
import { StatusMenu } from "./status-menu";

interface CardContext {
  projectId: string;
  moduleName: Record<string, string>;
  parentTitle: Record<string, string>;
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  blockedMap: Record<string, boolean>;
  subtaskStats: Record<string, { done: number; total: number }>;
  onOpenTask: (id: string) => void;
}

/**
 * Board view of the Tasks tab: one column per status, across every module.
 * Dropping a card on another column changes its status; order inside a
 * column follows module order, then the task's own order, so it reads the
 * same way the list does.
 */
export function TaskBoard({
  projectId,
  modules,
  tasks,
  allTasks,
  userMap,
  labelMap,
  blockedMap,
  subtaskStats,
  onOpenTask,
}: {
  projectId: string;
  modules: Module[];
  /** The tasks to show — already filtered. */
  tasks: Task[];
  /** The whole project, for subtask parent titles. */
  allTasks: Task[];
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  blockedMap: Record<string, boolean>;
  subtaskStats: Record<string, { done: number; total: number }>;
  onOpenTask: (id: string) => void;
}) {
  const update = useUpdateTask(projectId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const ctx: CardContext = useMemo(
    () => ({
      projectId,
      moduleName: Object.fromEntries(modules.map((m) => [m.id, m.name])),
      parentTitle: Object.fromEntries(allTasks.map((t) => [t.id, t.title])),
      userMap,
      labelMap,
      blockedMap,
      subtaskStats,
      onOpenTask,
    }),
    [projectId, modules, allTasks, userMap, labelMap, blockedMap, subtaskStats, onOpenTask],
  );

  const columns = useMemo(() => {
    const moduleRank = new Map(modules.map((m, i) => [m.id, i]));
    const byStatus = Object.fromEntries(
      TASK_STATUSES.map((s) => [s, [] as Task[]]),
    ) as Record<TaskStatus, Task[]>;
    for (const t of tasks) byStatus[t.status].push(t);
    for (const s of TASK_STATUSES) {
      byStatus[s].sort(
        (a, b) =>
          (moduleRank.get(a.moduleId) ?? 0) - (moduleRank.get(b.moduleId) ?? 0) ||
          a.order - b.order,
      );
    }
    return byStatus;
  }, [modules, tasks]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over ? String(e.over.id) : "";
    if (!over.startsWith("status:")) return;
    const next = over.slice(7) as TaskStatus;
    const task = tasks.find((t) => t.id === e.active.id);
    if (!task || task.status === next) return;
    // Failure is reported (and the card moved back) by useUpdateTask.
    update.mutate({ id: task.id, status: statusToProto(next) });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Columns keep a readable width and scroll sideways inside the tab on
          narrow screens rather than squeezing four lists into a phone. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {TASK_STATUSES.map((s) => (
          <BoardColumn key={s} status={s} tasks={columns[s]} ctx={ctx} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && <BoardCard task={activeTask} ctx={ctx} overlay />}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  status,
  tasks,
  ctx,
}: {
  status: TaskStatus;
  tasks: Task[];
  ctx: CardContext;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` });
  const c = TASK_STATUS_CONFIG[status];
  return (
    <section
      ref={setNodeRef}
      aria-label={c.label}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col rounded-xl bg-surface-sunken/60 p-2 lg:w-auto",
        "transition-shadow [transition-duration:var(--duration-fast)]",
        isOver && "ring-2 ring-focus",
      )}
    >
      <header className="flex items-center gap-2 px-2 pb-2 pt-1">
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", c.dot)} />
        <h3 className="text-sm font-medium">{c.label}</h3>
        <span className="text-num text-xs text-text-muted">{tasks.length}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} ctx={ctx} />
        ))}
        {tasks.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-xs text-text-subtle">
            No tasks
          </p>
        )}
      </div>
    </section>
  );
}

function DraggableCard({ task, ctx }: { task: Task; ctx: CardContext }) {
  const pending = isOptimisticTaskId(task.id);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: task.id,
    disabled: pending,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "rounded-lg outline-none",
        isDragging && "opacity-40",
        pending && "opacity-60",
      )}
    >
      <BoardCard task={task} ctx={ctx} />
    </div>
  );
}

function BoardCard({
  task,
  ctx,
  overlay = false,
}: {
  task: Task;
  ctx: CardContext;
  overlay?: boolean;
}) {
  const progress = ctx.subtaskStats[task.id];
  const parent = task.parentId ? ctx.parentTitle[task.parentId] : undefined;
  const done = task.status === "done" || task.status === "cancelled";
  const pending = isOptimisticTaskId(task.id);

  return (
    <article
      className={cn(
        "group relative space-y-2 rounded-lg bg-surface-raised p-3 shadow-1",
        "transition-shadow [transition-duration:var(--duration-fast)] hover:shadow-2",
        overlay ? "rotate-1 cursor-grabbing shadow-3" : "cursor-grab",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="truncate">{ctx.moduleName[task.moduleId]}</span>
        {ctx.blockedMap[task.id] && (
          <span className="ml-auto shrink-0 rounded-full bg-danger-subtle px-2 py-0.5 font-medium text-danger">
            Blocked
          </span>
        )}
      </div>

      {parent && (
        <p className="flex items-center gap-1 truncate text-xs text-text-subtle">
          <CornerDownRight aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="truncate">{parent}</span>
        </p>
      )}

      {/* Stretched: a click anywhere on the card that isn't another control
          opens the task. A drag starts only past 5px, so it never fires. */}
      <button
        type="button"
        disabled={pending}
        onClick={() => ctx.onOpenTask(task.id)}
        className={cn(
          "line-clamp-2 block text-left text-sm font-medium outline-none",
          "after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-focus",
          done && "text-text-muted line-through",
        )}
      >
        {task.title}
      </button>

      {task.labelIds.length > 0 && (
        <LabelChips ids={task.labelIds} labelMap={ctx.labelMap} max={3} />
      )}

      <div className="flex items-center gap-3">
        <PriorityLabel priority={task.priority} />
        <DueDate task={task} />
        {progress && (
          <span className="text-num text-xs text-text-muted" title="Subtasks done">
            {progress.done}/{progress.total}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <AssigneeAvatars ids={task.assigneeIds} userMap={ctx.userMap} />
          {/* The keyboard/touch way to move a card; dragging is the other. */}
          {!overlay && (
            <StatusMenu
              projectId={ctx.projectId}
              task={task}
              compact
              className="relative z-10"
            />
          )}
        </div>
      </div>
    </article>
  );
}
