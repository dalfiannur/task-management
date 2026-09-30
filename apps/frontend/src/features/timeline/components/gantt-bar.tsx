import { useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/features/tasks";
import { TASK_STATUS_CONFIG, isOverdue } from "@/features/tasks";
import { ROW_HEIGHT, toIso } from "../timeline-utils";

export interface ReschedulePatch {
  startDate?: string;
  dueDate?: string;
}

type Mode = "move" | "resize-left" | "resize-right";

const BAR_H = 22;

// Status drives the fill, strongest for what is moving right now. "To do" is
// the calm default, done/cancelled are history and step back (aturan 4).
// Overdue overrides the status fill below — it is the one thing on this chart
// that asks for action.
const STATUS_BAR: Record<TaskStatus, string> = {
  todo: "bg-brand-subtle text-brand-text",
  in_progress: "bg-brand text-text-on-brand",
  done: "bg-surface-hover text-text-muted",
  cancelled: "bg-surface-sunken text-text-subtle line-through",
};

function rangeLabel(span: { start: Date; end: Date }) {
  const days = differenceInCalendarDays(span.end, span.start) + 1;
  const start = format(span.start, "MMM d");
  if (days === 1) return start;
  return `${start} – ${format(span.end, "MMM d")} · ${days}d`;
}

/** A task bar: drag body to shift (preserving duration), drag ends to resize,
 *  click to open. Commits on pointer-up via onReschedule; preview is local
 *  during drag. */
export function GanttBar({
  task,
  span,
  left,
  width,
  pxPerDay,
  canEdit,
  onReschedule,
  onOpen,
  conflict,
}: {
  task: Task;
  span: { start: Date; end: Date };
  left: number;
  width: number;
  pxPerDay: number;
  canEdit: boolean;
  onReschedule: (taskId: string, patch: ReschedulePatch) => void;
  onOpen: (taskId: string) => void;
  /** True when this task sits on a conflicting dependency edge, either side. */
  conflict?: boolean;
}) {
  const [drag, setDrag] = useState<{ mode: Mode; startX: number; delta: number } | null>(
    null,
  );

  function down(mode: Mode) {
    return (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ mode, startX: e.clientX, delta: 0 });
    };
  }

  function move(e: React.PointerEvent) {
    if (!drag || !canEdit) return;
    const delta = Math.round((e.clientX - drag.startX) / pxPerDay);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  }

  function up() {
    if (!drag) return;
    const { mode, delta } = drag;
    setDrag(null);
    // No movement: a click. Opening from a resize handle would be a surprise,
    // so only the body opens the task.
    if (delta === 0) {
      if (mode === "move") onOpen(task.id);
      return;
    }

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

  const overdue = isOverdue(task);
  // A bar narrower than its label shows the title beside it instead of a
  // truncated "…" — at month zoom a one-day task is 5px wide.
  const narrow = pWidth < 48;

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onPointerDown={down("move")}
      style={{
        left: pLeft,
        width: pWidth,
        top: (ROW_HEIGHT - BAR_H) / 2,
        height: BAR_H,
      }}
      className={cn(
        // z-20 milik urutan lapis yang didefinisikan di gantt-chart.tsx: di
        // ATAS fade tepi kanan, di BAWAH kolom nama yang sticky. Tanpa angka
        // eksplisit bar jatuh ke z-auto dan fade yang ber-z-index menang.
        "group absolute z-20 flex items-center rounded-md px-2 text-xs font-medium",
        "outline-none focus-visible:ring-2 focus-visible:ring-focus",
        "[transition:box-shadow_var(--duration-fast)_var(--ease-out)] hover:shadow-1",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        overdue ? "bg-danger text-text-on-danger" : STATUS_BAR[task.status],
        // Conflict ring loses to the drag ring — mid-drag feedback is the
        // more urgent signal, and the conflict is still visible once released.
        // The offset keeps it legible on an overdue (danger-filled) bar.
        conflict &&
          "ring-2 ring-danger ring-offset-1 ring-offset-surface-raised",
        drag && "ring-2 ring-focus",
      )}
      title={[
        task.title,
        rangeLabel(span),
        TASK_STATUS_CONFIG[task.status].label,
        overdue && "Overdue",
        conflict && "Dependency conflict",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {canEdit && (
        <span
          onPointerDown={down("resize-left")}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md bg-current opacity-0 group-hover:opacity-30"
        />
      )}
      {narrow ? (
        <span className="pointer-events-none absolute left-full ml-1.5 whitespace-nowrap text-text-muted">
          {task.title}
        </span>
      ) : (
        <span className="truncate">{task.title}</span>
      )}
      {canEdit && (
        <span
          onPointerDown={down("resize-right")}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md bg-current opacity-0 group-hover:opacity-30"
        />
      )}
      <span className="sr-only">
        {TASK_STATUS_CONFIG[task.status].label}
        {overdue && " · Overdue"}
        {conflict && " · Dependency conflict"}
      </span>
    </div>
  );
}
