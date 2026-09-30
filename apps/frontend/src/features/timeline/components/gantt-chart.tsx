import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtom, useAtomValue } from "jotai";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarRange, ChevronRight, Crosshair, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { useProjectMembers } from "@/features/projects";
import { useUserMap } from "@/features/users";
import {
  TASK_STATUS_CONFIG,
  TaskDialog,
  allConflicts,
  buildHierarchy,
  collapsedModulesAtom,
  statsByModule,
  useModuleCollapsed,
  useModules,
  useTasks,
  useUpdateTask,
  type ModuleStats,
  type Task,
} from "@/features/tasks";
import {
  PX_PER_DAY,
  ROW_HEIGHT,
  barGeometry,
  buildGroups,
  buildTicks,
  computeRange,
  dayOffset,
  effectiveSpan,
  isScheduled,
  rangeDays,
  toIso,
  weekendOffsets,
  type Zoom,
} from "../timeline-utils";
import { timelineZoomAtom } from "../atoms/zoom";
import { DependencyLayer } from "./dependency-layer";
import { GanttBar, type ReschedulePatch } from "./gantt-bar";
import { UnscheduledPanel } from "./unscheduled-panel";

const ZOOMS: { key: Zoom; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];
const NAME_COL = 260;
// Two header tiers: month/year groups on top, day/week/month ticks below.
const GROUP_H = 22;
const TICK_H = 26;
const HEADER_H = GROUP_H + TICK_H;
// One indent step per subtask depth (1 level only), on top of the name
// column's own inset — mirrors the task list's pl-10 (12px base + 24px step).
const NAME_INDENT_BASE = 12;
const NAME_INDENT_STEP = 24;
const SUMMARY_H = 6;
const EMPTY_STATS: ModuleStats = { done: 0, total: 0, overdue: 0 };

type Span = { start: Date; end: Date };

type Row =
  | {
      kind: "module";
      id: string;
      name: string;
      stats: ModuleStats;
      /** Earliest start → latest end over the module's scheduled tasks. */
      span: Span;
      collapsed: boolean;
    }
  | {
      kind: "task";
      id: string;
      name: string;
      task: Task;
      span: Span;
      /** 0 = top-level, 1 = subtask. */
      depth: number;
    };

export function GanttChart({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { task: taskParam, comment: commentParam } = useSearch({
    from: "/_authed/projects/$projectId",
  });
  const { modules, isLoading: ml } = useModules(projectId);
  const { tasks, isLoading: tl } = useTasks(projectId);
  const { memberIds } = useProjectMembers(projectId);
  const userMap = useUserMap();
  const update = useUpdateTask(projectId);
  const [zoom, setZoom] = useAtom(timelineZoomAtom);
  const collapsedIds = useAtomValue(collapsedModulesAtom)[projectId];

  // Viewers reach this tab only as members/admins (GetProject/ListTasks gate),
  // so date edits are allowed; the backend re-checks on UpdateTask.
  const canEdit = true;
  const pxPerDay = PX_PER_DAY[zoom];
  const today = useMemo(() => new Date(), []);
  const range = useMemo(() => computeRange(tasks, today), [tasks, today]);
  const days = useMemo(() => rangeDays(range), [range]);
  const ticks = useMemo(() => buildTicks(range, zoom), [range, zoom]);
  const groups = useMemo(() => buildGroups(range, zoom), [range, zoom]);
  const weekends = useMemo(
    () => (zoom === "day" ? weekendOffsets(range) : []),
    [range, zoom],
  );
  const gridWidth = days.length * pxPerDay;
  const todayX = (dayOffset(today, range.start) + 0.5) * pxPerDay;

  const moduleNames = useMemo(
    () => Object.fromEntries(modules.map((m) => [m.id, m.name])),
    [modules],
  );

  const { rows, unscheduled, scheduledCount } = useMemo(() => {
    const collapsed = new Set(collapsedIds ?? []);
    // Stats over every task in the module, scheduled or not: the header
    // answers "how far along is this module", same numbers as the Tasks tab.
    const stats = statsByModule(tasks);
    const byModule: Record<string, Task[]> = {};
    const unsched: Task[] = [];
    for (const t of tasks) {
      if (isScheduled(t)) (byModule[t.moduleId] ??= []).push(t);
      else unsched.push(t);
    }
    const rowList: Row[] = [];
    let count = 0;
    for (const m of modules) {
      const mt = byModule[m.id] ?? [];
      if (mt.length === 0) continue;
      count += mt.length;

      let span: Span | null = null;
      for (const t of mt) {
        const s = effectiveSpan(t)!;
        if (!span) span = { ...s };
        else {
          if (s.start < span.start) span.start = s.start;
          if (s.end > span.end) span.end = s.end;
        }
      }
      const isCollapsed = collapsed.has(m.id);
      rowList.push({
        kind: "module",
        id: m.id,
        name: m.name,
        stats: stats[m.id] ?? EMPTY_STATS,
        span: span!,
        collapsed: isCollapsed,
      });
      if (isCollapsed) continue;

      // Hierarchy scoped to this module's *scheduled* tasks: buildHierarchy's
      // `roots` only covers tasks with no parentId. A subtask whose parent
      // isn't itself scheduled would otherwise vanish rather than nest under
      // it — `orphaned` promotes it back to the top level instead.
      const { roots, childrenOf } = buildHierarchy(mt);
      const scheduledIds = new Set(mt.map((t) => t.id));
      const orphaned = mt.filter((t) => t.parentId && !scheduledIds.has(t.parentId));
      const topLevel = [...roots, ...orphaned].sort((a, b) => a.order - b.order);
      for (const t of topLevel) {
        rowList.push({
          kind: "task",
          id: t.id,
          name: t.title,
          task: t,
          span: effectiveSpan(t)!,
          depth: 0,
        });
        for (const child of childrenOf[t.id] ?? []) {
          rowList.push({
            kind: "task",
            id: child.id,
            name: child.title,
            task: child,
            span: effectiveSpan(child)!,
            depth: 1,
          });
        }
      }
    }
    return { rows: rowList, unscheduled: unsched, scheduledCount: count };
  }, [modules, tasks, collapsedIds]);

  // taskId → y offset of its row, for the dependency overlay. Rows (module
  // headers included) are all ROW_HEIGHT tall and stack directly under the
  // header, so the index alone gives the offset — no separate layout pass.
  // Tasks in a collapsed module have no row, so their arrows are skipped.
  const rowTop = useMemo(() => {
    const out: Record<string, number> = {};
    rows.forEach((r, i) => {
      if (r.kind === "task") out[r.id] = HEADER_H + i * ROW_HEIGHT;
    });
    return out;
  }, [rows]);
  const bodyHeight = rows.length * ROW_HEIGHT;
  const gridHeight = HEADER_H + bodyHeight;

  // Every task on either end of a conflicting dependency edge, so its bar
  // can carry the same warning the arrow does.
  const conflictTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of allConflicts(tasks)) {
      ids.add(c.blockerId);
      ids.add(c.dependentId);
    }
    return ids;
  }, [tasks]);

  // Dua tepi scroll horizontal, dilacak supaya sinyalnya hanya muncul saat ada
  // yang benar-benar tersembunyi: `start` menguatkan pemisah kolom nama yang
  // sedang menimpa grid, `end` menyalakan fade di tepi kanan. Menyalakan
  // keduanya permanen sama saja dengan tidak menyalakan apa pun (aturan 4).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft > 0;
    // -1px: scrollWidth/clientWidth dibulatkan berbeda pada zoom non-100%,
    // jadi perbandingan persis tidak pernah true di ujung kanan.
    const end = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setEdge((p) => (p.start === start && p.end === end ? p : { start, end }));
  }, []);

  // Isi berubah: lebar grid ikut zoom, jumlah baris ikut task yang dijadwalkan.
  useLayoutEffect(measure, [measure, gridWidth, rows.length]);

  // Container berubah: bukan hanya resize window — sidebar yang menciut juga
  // mengubah clientWidth tanpa satu pun event resize.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, rows.length]);

  // Put today a third of the way into the visible grid — enough runway on
  // the left to see what just finished, most of the view for what's next.
  const scrollToToday = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollRef.current;
      if (!el) return;
      const visible = el.clientWidth - NAME_COL;
      el.scrollTo({ left: Math.max(0, todayX - visible / 3), behavior });
    },
    [todayX],
  );

  // On arrival and on every zoom change — a zoom rescales every x, so the
  // old scroll position would land somewhere arbitrary. Not on data changes:
  // a drag that widens the range must not yank the view away mid-edit.
  const hasGrid = rows.length > 0;
  useLayoutEffect(() => {
    if (hasGrid) scrollToToday("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, hasGrid]);

  function setTaskSearch(next: { task?: string; comment?: string }) {
    navigate({ to: ".", search: (prev) => ({ ...prev, ...next }) });
  }
  function openTask(id: string) {
    setTaskSearch({ task: id, comment: undefined });
  }
  function closeTask() {
    setTaskSearch({ task: undefined, comment: undefined });
  }

  // `tasks` is this project's full list, so a `?task=` that isn't in it is
  // deleted, inaccessible or moved elsewhere — say so and drop the param
  // rather than leaving the dialog stuck on its loading state.
  const openedTask = taskParam
    ? tasks.find((t) => t.id === taskParam)
    : undefined;
  const staleTaskParam = !!taskParam && !tl && !openedTask;
  useEffect(() => {
    if (!staleTaskParam) return;
    toast.error("Task not found, or you do not have access");
    closeTask();
    // closeTask uses navigate's functional updater — see all-tasks-tab.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleTaskParam]);

  function reschedule(taskId: string, patch: ReschedulePatch) {
    update.mutate(
      { id: taskId, ...patch },
      { onError: (err) => toast.error(err.message || "Reschedule failed") },
    );
  }
  function schedule(taskId: string, date: Date) {
    const iso = toIso(date);
    update.mutate(
      { id: taskId, startDate: iso, dueDate: iso },
      { onError: (err) => toast.error(err.message || "Schedule failed") },
    );
  }

  if (ml || tl) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40 rounded-md" />
          <Skeleton className="h-8 w-56 rounded-full" />
        </div>
        <Skeleton className="h-80 w-full rounded-xl shadow-2" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-label">Timeline</h2>
          <p className="text-num text-sm text-text-muted">
            {scheduledCount} scheduled
            {unscheduled.length > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("timeline-unscheduled")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="underline-offset-2 hover:text-text hover:underline"
                >
                  {unscheduled.length} unscheduled
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasGrid && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => scrollToToday("smooth")}
            >
              <Crosshair aria-hidden="true" className="mr-1 h-4 w-4" />
              Today
            </Button>
          )}
          <div
            role="group"
            aria-label="Zoom"
            className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]"
          >
            {ZOOMS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setZoom(key)}
                aria-pressed={zoom === key}
                className={cn(
                  "rounded-full px-3 py-1 text-sm",
                  "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                  zoom === key
                    ? "bg-surface-raised font-medium text-text shadow-1"
                    : "text-text-muted hover:text-text",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Plan this project on a timeline"
          body="Tasks with a start or due date show up here as bars you can drag to reschedule. Add tasks first."
          action={{
            label: "Go to tasks",
            to: "/projects/$projectId/all-tasks",
            params: { projectId },
          }}
        />
      ) : !hasGrid ? (
        <div className="rounded-xl bg-surface-raised shadow-2">
          <EmptyState
            size="compact"
            icon={ListTodo}
            title="No scheduled tasks yet"
            body="Give a task a date below and it lands on the timeline."
            action={{
              label: "Schedule a task",
              onClick: () =>
                document
                  .getElementById("timeline-unscheduled")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            }}
          />
        </div>
      ) : (
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={measure}
            className="scrollbar-slim overflow-x-auto rounded-xl bg-surface-raised shadow-2"
          >
            {/* w-max: tanpa ini flex item menyusut ke lebar viewport dan latar
                baris modul berhenti di tengah grid. */}
            <div className="flex w-max">
              {/* Left: names — sticky supaya nama baris tidak ikut hilang saat
                  grid di-scroll ke kanan.

                  URUTAN LAPIS grid ini, dipakai bersama gantt-bar.tsx dan
                  dependency-layer.tsx:
                    z-auto  latar (baris modul, akhir pekan, gridline, garis
                            hari ini), label header
                    z-10    fade tepi kanan     — meredam grid, bukan bar
                    z-15    DependencyLayer     — di atas fade, di bawah bar
                    z-20    GanttBar            — tetap pekat sampai tepi kartu
                    z-30    kolom nama          — menang atas semuanya
                  Angka eksplisit wajib: `overflow-x` TIDAK membuat stacking
                  context, jadi semuanya beradu di context yang sama dan
                  urutan DOM saja tidak cukup. */}
              <div
                className={cn(
                  "sticky left-0 z-30 shrink-0 bg-surface-raised border-r",
                  "transition-colors [transition-duration:var(--duration)]",
                  // Saat kolom ini benar-benar menimpa grid, pemisahnya naik
                  // dari halus jadi landmark (depth.md §5).
                  edge.start ? "border-border-strong" : "border-border-subtle",
                )}
                style={{ width: NAME_COL }}
              >
                <div
                  style={{ height: HEADER_H }}
                  className="flex items-end border-b border-border-subtle px-3 pb-1.5 text-xs font-medium text-text-muted"
                >
                  Module / task
                </div>
                {rows.map((r) =>
                  r.kind === "module" ? (
                    <ModuleNameRow
                      key={r.id}
                      projectId={projectId}
                      row={r}
                    />
                  ) : (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openTask(r.id)}
                      style={{
                        height: ROW_HEIGHT,
                        paddingLeft:
                          NAME_INDENT_BASE + (r.depth + 1) * NAME_INDENT_STEP - 8,
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 border-b border-border-subtle pr-3 text-left text-sm",
                        "transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover",
                        r.task.status === "done" || r.task.status === "cancelled"
                          ? "text-text-muted"
                          : "text-text",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          TASK_STATUS_CONFIG[r.task.status].dot,
                        )}
                      />
                      <span
                        className={cn(
                          "truncate",
                          r.task.status === "cancelled" && "line-through",
                        )}
                      >
                        {r.name}
                      </span>
                      <span className="sr-only">
                        {" "}
                        · {TASK_STATUS_CONFIG[r.task.status].label}
                      </span>
                    </button>
                  ),
                )}
              </div>

              {/* Right: grid */}
              <div className="relative shrink-0" style={{ width: gridWidth }}>
                {/* Header, tier 1: months (years at month zoom). */}
                <div
                  className="relative border-b border-border-subtle"
                  style={{ height: GROUP_H }}
                >
                  {groups.map((g) => (
                    <div
                      key={g.offset}
                      className="absolute top-0 flex h-full border-l border-border-strong"
                      style={{ left: g.offset * pxPerDay, width: g.days * pxPerDay }}
                    >
                      {/* Sticky just past the name column, so the month
                          stays named while its first days are scrolled
                          away under the names. A flex item, so it is only
                          as wide as its text — a full-width sticky box has
                          no room inside its parent to move. */}
                      <span
                        className="sticky flex h-full items-center whitespace-nowrap pl-2 pr-2 text-xs font-medium text-text"
                        style={{ left: NAME_COL }}
                      >
                        {g.label}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Header, tier 2: days / week starts / months. */}
                <div
                  className="relative border-b border-border-subtle"
                  style={{ height: TICK_H }}
                >
                  {weekends.map((o) => (
                    <div
                      key={o}
                      className="absolute top-0 h-full bg-surface-sunken"
                      style={{ left: o * pxPerDay, width: pxPerDay }}
                    />
                  ))}
                  {ticks.map((t) => (
                    <div
                      key={t.offset}
                      className={cn(
                        "text-num absolute top-0 flex h-full items-center border-l text-xs text-text-muted",
                        zoom === "day" ? "justify-center" : "pl-1.5",
                        // Mayor memakai --border-STRONG, bukan --border: di
                        // dark --border dan --surface-raised dua-duanya
                        // grey-800, jadi garis landmark justru hilang.
                        t.major ? "border-border-strong" : "border-border-subtle",
                      )}
                      style={{
                        left: t.offset * pxPerDay,
                        width: zoom === "day" ? pxPerDay : undefined,
                      }}
                    >
                      {t.label}
                    </div>
                  ))}
                  <div
                    className="absolute bottom-0.5 z-[1] -translate-x-1/2 rounded-full bg-brand px-1.5 text-[10px] font-semibold leading-4 text-text-on-brand"
                    style={{ left: todayX }}
                  >
                    Today
                  </div>
                </div>

                {/* Body */}
                <div className="relative" style={{ height: bodyHeight }}>
                  {/* Background: drawn once for the whole body instead of per
                      row — module stripes, weekends, then gridlines on top of
                      both, then today. Every tick gets a line, not just the
                      major ones: reading a date off a bar's position is the
                      reason this grid exists (spec §4.10). */}
                  <div aria-hidden className="absolute inset-0">
                    {rows.map((r, i) =>
                      r.kind === "module" ? (
                        <div
                          key={r.id}
                          className="absolute inset-x-0 bg-surface-sunken"
                          style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                        />
                      ) : null,
                    )}
                    {weekends.map((o) => (
                      <div
                        key={o}
                        className="absolute inset-y-0 bg-surface-sunken"
                        style={{ left: o * pxPerDay, width: pxPerDay }}
                      />
                    ))}
                    {ticks.map((t) => (
                      <div
                        key={t.offset}
                        className={cn(
                          "absolute inset-y-0 border-l",
                          t.major ? "border-border-strong" : "border-border-subtle",
                        )}
                        style={{ left: t.offset * pxPerDay }}
                      />
                    ))}
                    <div
                      className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand"
                      style={{ left: todayX }}
                    />
                  </div>

                  {rows.map((r) => (
                    <div
                      key={r.id}
                      style={{ height: ROW_HEIGHT }}
                      className="relative border-b border-border-subtle"
                    >
                      {r.kind === "task" ? (
                        <GanttBar
                          task={r.task}
                          span={r.span}
                          {...barGeometry(r.span, range.start, pxPerDay)}
                          pxPerDay={pxPerDay}
                          canEdit={canEdit}
                          onReschedule={reschedule}
                          onOpen={openTask}
                          conflict={conflictTaskIds.has(r.task.id)}
                        />
                      ) : (
                        <ModuleSummaryBar
                          stats={r.stats}
                          {...barGeometry(r.span, range.start, pxPerDay)}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* z-[15] — see the layer-order note above; not a scale step,
                    just "between fade (z-10) and bar (z-20)". */}
                <div className="pointer-events-none absolute left-0 top-0 z-[15]">
                  <DependencyLayer
                    tasks={tasks}
                    rowTop={rowTop}
                    rangeStart={range.start}
                    pxPerDay={pxPerDay}
                    width={gridWidth}
                    height={gridHeight}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Fade tepi kanan: satu-satunya penanda bahwa grid masih berlanjut.
              Menghilang saat sudah mentok kanan. z-10: DI BAWAH bar — yang
              diredam adalah grid; bar yang masih berlanjut tetap pekat. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 z-10 w-12 rounded-r-xl",
              "bg-linear-to-l from-surface-raised to-transparent",
              "transition-opacity [transition-duration:var(--duration)]",
              edge.end ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
      )}

      <UnscheduledPanel
        tasks={unscheduled}
        moduleNames={moduleNames}
        canEdit={canEdit}
        onSchedule={schedule}
        onOpen={openTask}
      />

      {/* URL-driven, same `?task=` the Tasks tab uses, so a link copied from
          either tab opens the same dialog. */}
      <TaskDialog
        open={!!openedTask}
        onOpenChange={(open) => {
          if (!open) closeTask();
        }}
        projectId={projectId}
        moduleId={openedTask?.moduleId ?? ""}
        task={openedTask}
        editing
        highlightCommentId={commentParam}
        memberIds={memberIds}
        userMap={userMap}
        tasks={tasks}
        onOpenTask={openTask}
      />
    </div>
  );
}

/** Module header in the name column: collapse toggle + progress. Its own
 *  component so it can use the per-module collapse hook the Tasks tab uses —
 *  folding a module here folds it there too. */
function ModuleNameRow({
  projectId,
  row,
}: {
  projectId: string;
  row: Extract<Row, { kind: "module" }>;
}) {
  const [collapsed, setCollapsed] = useModuleCollapsed(projectId, row.id);
  const { done, total, overdue } = row.stats;
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      style={{ height: ROW_HEIGHT }}
      className="flex w-full items-center gap-1.5 border-b border-border-subtle bg-surface-sunken px-2 text-left text-sm"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "h-4 w-4 shrink-0 text-text-muted [transition:transform_var(--duration-fast)_var(--ease-out)]",
          !collapsed && "rotate-90",
        )}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
      {overdue > 0 && (
        <span className="text-num shrink-0 rounded-full bg-danger-subtle px-1.5 text-xs font-medium text-danger">
          {overdue}
          <span className="sr-only"> overdue</span>
        </span>
      )}
      <span className="text-num shrink-0 text-xs text-text-muted">
        {done}/{total}
        <span className="sr-only"> done</span>
      </span>
    </button>
  );
}

/** Thin span bar on a module row: where the module's work sits in time, and
 *  how much of it is done. */
function ModuleSummaryBar({
  stats,
  left,
  width,
}: {
  stats: ModuleStats;
  left: number;
  width: number;
}) {
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  return (
    <div
      className="absolute overflow-hidden rounded-full bg-border-strong"
      style={{
        left,
        width,
        top: (ROW_HEIGHT - SUMMARY_H) / 2,
        height: SUMMARY_H,
      }}
      title={`${stats.done}/${stats.total} done · ${pct}%`}
    >
      <div className="h-full bg-success" style={{ width: `${pct}%` }} />
    </div>
  );
}
