import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useModules, useTasks, useUpdateTask, type Task } from "@/features/tasks";
import {
  PX_PER_DAY,
  ROW_HEIGHT,
  barGeometry,
  buildTicks,
  computeRange,
  effectiveSpan,
  isScheduled,
  rangeDays,
  toIso,
  type Zoom,
} from "../timeline-utils";
import { GanttBar, type ReschedulePatch } from "./gantt-bar";
import { UnscheduledPanel } from "./unscheduled-panel";

const ZOOMS: Zoom[] = ["day", "week", "month"];
const NAME_COL = 220;
const HEADER_H = 32;

interface Row {
  kind: "module" | "task";
  id: string;
  name: string;
  task?: Task;
  span?: { start: Date; end: Date };
}

export function GanttChart({ projectId }: { projectId: string }) {
  const { modules, isLoading: ml } = useModules(projectId);
  const { tasks, isLoading: tl } = useTasks(projectId);
  const update = useUpdateTask();
  const [zoom, setZoom] = useState<Zoom>("day");

  // Viewers reach this tab only as members/admins (GetProject/ListTasks gate),
  // so date edits are allowed; the backend re-checks on UpdateTask.
  const canEdit = true;
  const pxPerDay = PX_PER_DAY[zoom];
  const today = useMemo(() => new Date(), []);
  const range = useMemo(() => computeRange(tasks, today), [tasks, today]);
  const days = useMemo(() => rangeDays(range), [range]);
  const ticks = useMemo(() => buildTicks(range, zoom), [range, zoom]);
  const gridWidth = days.length * pxPerDay;

  const { rows, unscheduled } = useMemo(() => {
    const byModule: Record<string, Task[]> = {};
    const unsched: Task[] = [];
    for (const t of tasks) {
      if (isScheduled(t)) (byModule[t.moduleId] ??= []).push(t);
      else unsched.push(t);
    }
    const rowList: Row[] = [];
    for (const m of modules) {
      const mt = (byModule[m.id] ?? []).sort((a, b) => a.order - b.order);
      if (mt.length === 0) continue;
      rowList.push({ kind: "module", id: m.id, name: m.name });
      for (const t of mt) {
        rowList.push({
          kind: "task",
          id: t.id,
          name: t.title,
          task: t,
          span: effectiveSpan(t)!,
        });
      }
    }
    return { rows: rowList, unscheduled: unsched };
  }, [modules, tasks]);

  function reschedule(taskId: string, patch: ReschedulePatch) {
    update.mutate(
      { id: taskId, ...patch },
      { onError: (e) => toast.error(e.message || "Reschedule failed") },
    );
  }
  function schedule(taskId: string, date: Date) {
    const iso = toIso(date);
    update.mutate(
      { id: taskId, startDate: iso, dueDate: iso },
      { onError: (e) => toast.error(e.message || "Schedule failed") },
    );
  }

  if (ml || tl) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48 rounded-full" />
        <Skeleton className="h-64 w-full rounded-xl shadow-2" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-label">Timeline</h2>
        <div className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]">
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                "rounded-full px-3 py-1 text-sm capitalize transition-colors",
                "[transition-duration:var(--duration-fast)]",
                zoom === z
                  ? "bg-surface-raised font-medium text-text shadow-1"
                  : "text-text-muted hover:text-text",
              )}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
          No scheduled tasks yet. Schedule tasks below to see them here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface-raised shadow-2">
          <div className="flex">
            {/* Left: names */}
            <div
              className="shrink-0 border-r border-border-subtle"
              style={{ width: NAME_COL }}
            >
              <div
                style={{ height: HEADER_H }}
                className="border-b border-border-subtle"
              />
              {rows.map((r) => (
                <div
                  key={r.id}
                  style={{ height: ROW_HEIGHT }}
                  className={cn(
                    "flex items-center truncate px-3 text-sm",
                    r.kind === "module"
                      ? "bg-surface-sunken font-medium"
                      : "text-text-muted",
                  )}
                >
                  {r.kind === "task" ? "· " : ""}
                  {r.name}
                </div>
              ))}
            </div>

            {/* Right: grid */}
            <div className="relative" style={{ width: gridWidth }}>
              <div
                className="relative border-b border-border-subtle"
                style={{ height: HEADER_H }}
              >
                {ticks.map((t) => (
                  <div
                    key={t.offset}
                    className={cn(
                      "text-num absolute top-0 flex h-full items-center border-l pl-1 text-xs text-text-muted",
                      // Batas minor vs mayor: dua tingkat, dua token — bukan
                      // dua nilai alpha dari --text yang tidak pernah diukur.
                      t.major ? "border-border" : "border-border-subtle",
                    )}
                    style={{ left: t.offset * pxPerDay }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
              {rows.map((r) => (
                <div
                  key={r.id}
                  style={{ height: ROW_HEIGHT }}
                  className={cn(
                    "relative border-b border-border-subtle",
                    r.kind === "module" && "bg-surface-sunken",
                  )}
                >
                  {/* Gridline vertikal — SEMUA tick, bukan hanya yang mayor.
                      Sebelumnya baris hanya menggambar tick mayor, dan pada
                      zoom `day` mayor berarti "tanggal 1", jadi tampilan
                      sebulan hanya punya SATU garis. Membaca tanggal dari
                      posisi bar mustahil tanpa ini — dan itu justru alasan
                      grid ini dipertahankan (spec §4.10).
                      Dua bobot, dua token: hari halus, batas mayor sedikit
                      lebih berat supaya terbaca sebagai landmark. */}
                  {ticks.map((t) => (
                    <div
                      key={t.offset}
                      className={cn(
                        "absolute top-0 h-full border-l",
                        t.major ? "border-border" : "border-border-subtle",
                      )}
                      style={{ left: t.offset * pxPerDay }}
                    />
                  ))}
                  {r.kind === "task" && r.task && r.span && (
                    <GanttBar
                      task={r.task}
                      span={r.span}
                      {...barGeometry(r.span, range.start, pxPerDay)}
                      pxPerDay={pxPerDay}
                      canEdit={canEdit}
                      onReschedule={reschedule}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <UnscheduledPanel
        tasks={unscheduled}
        canEdit={canEdit}
        onSchedule={schedule}
      />
    </div>
  );
}
