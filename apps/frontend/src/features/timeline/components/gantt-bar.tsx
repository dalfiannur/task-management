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
  conflict,
}: {
  task: Task;
  span: { start: Date; end: Date };
  left: number;
  width: number;
  pxPerDay: number;
  canEdit: boolean;
  onReschedule: (taskId: string, patch: ReschedulePatch) => void;
  /** True when this task sits on a conflicting dependency edge, either side. */
  conflict?: boolean;
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
        // z-20 milik urutan lapis yang didefinisikan di gantt-chart.tsx: di
        // ATAS fade tepi kanan, di BAWAH kolom nama yang sticky. Tanpa angka
        // eksplisit bar jatuh ke z-auto dan fade yang ber-z-index menang.
        "absolute z-20 flex items-center rounded-full px-2.5 text-xs",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        // Task selesai adalah riwayat, bukan sinyal — ia diredupkan, bukan
        // diberi warna kedua yang ikut bersaing (aturan 4). Maknanya tetap
        // dibawa label sr-only di bawah, bukan warna saja (accessibility §5).
        done
          ? "bg-surface-hover text-text-muted"
          : "bg-brand text-text-on-brand",
        // Conflict ring loses to the drag ring — mid-drag feedback is the
        // more urgent signal, and the conflict is still visible once released.
        conflict && "ring-2 ring-danger",
        drag && "ring-2 ring-focus",
      )}
      title={conflict ? `${task.title} — dependency conflict` : task.title}
    >
      {canEdit && (
        <span
          onPointerDown={down("resize-left")}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-full bg-current opacity-30"
        />
      )}
      <span className="truncate">{task.title}</span>
      {canEdit && (
        <span
          onPointerDown={down("resize-right")}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-full bg-current opacity-30"
        />
      )}
      <span className="sr-only">
        {TASK_STATUS_CONFIG[task.status].label}
        {conflict && " · Dependency conflict"}
      </span>
    </div>
  );
}
