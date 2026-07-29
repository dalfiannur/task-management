import { useState } from "react";
import { addDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { Task } from "@/features/tasks";
import { TASK_STATUS_CONFIG } from "@/features/tasks";
import { ROW_HEIGHT, toIso } from "../timeline-utils";

export interface ReschedulePatch {
  startDate?: string;
  dueDate?: string;
}

type Mode = "move" | "resize-left" | "resize-right";

/** A task bar: drag body to shift (preserving duration), drag ends to resize.
 *  Commits on pointer-up via onReschedule; preview is local during drag. */
export function GanttBar({
  task,
  span,
  left,
  width,
  pxPerDay,
  canEdit,
  onReschedule,
}: {
  task: Task;
  span: { start: Date; end: Date };
  left: number;
  width: number;
  pxPerDay: number;
  canEdit: boolean;
  onReschedule: (taskId: string, patch: ReschedulePatch) => void;
}) {
  const [drag, setDrag] = useState<{ mode: Mode; startX: number; delta: number } | null>(
    null,
  );

  function down(mode: Mode) {
    return (e: React.PointerEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ mode, startX: e.clientX, delta: 0 });
    };
  }

  function move(e: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) / pxPerDay);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  }

  function up() {
    if (!drag) return;
    const { mode, delta } = drag;
    setDrag(null);
    if (delta === 0) return;

    if (mode === "move") {
      const patch: ReschedulePatch = {};
      if (task.startDate)
        patch.startDate = toIso(addDays(parseISO(task.startDate), delta));
      if (task.dueDate)
        patch.dueDate = toIso(addDays(parseISO(task.dueDate), delta));
      onReschedule(task.id, patch);
    } else if (mode === "resize-left") {
      let s = addDays(span.start, delta);
      if (s > span.end) s = span.end;
      onReschedule(task.id, { startDate: toIso(s) });
    } else {
      let d = addDays(span.end, delta);
      if (d < span.start) d = span.start;
      onReschedule(task.id, { dueDate: toIso(d) });
    }
  }

  // Live preview offsets while dragging.
  let pLeft = left;
  let pWidth = width;
  if (drag) {
    const dpx = drag.delta * pxPerDay;
    if (drag.mode === "move") pLeft = left + dpx;
    else if (drag.mode === "resize-left") {
      pLeft = Math.min(left + dpx, left + width - pxPerDay);
      pWidth = Math.max(pxPerDay, width - dpx);
    } else {
      pWidth = Math.max(pxPerDay, width + dpx);
    }
  }

  const done = task.status === "done";

  return (
    <div
      onPointerMove={move}
      onPointerUp={up}
      onPointerDown={down("move")}
      style={{
        left: pLeft,
        width: pWidth,
        top: (ROW_HEIGHT - 22) / 2,
        height: 22,
      }}
      className={cn(
        "absolute flex items-center rounded px-2 text-xs text-white",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        done ? "bg-green-600/80" : "bg-primary/80",
        drag && "ring-2 ring-primary",
      )}
      title={task.title}
    >
      {canEdit && (
        <span
          onPointerDown={down("resize-left")}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l bg-black/20"
        />
      )}
      <span className="truncate">{task.title}</span>
      {canEdit && (
        <span
          onPointerDown={down("resize-right")}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r bg-black/20"
        />
      )}
      <span className="sr-only">{TASK_STATUS_CONFIG[task.status].label}</span>
    </div>
  );
}
