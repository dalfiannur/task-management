import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  allConflicts,
  buildHierarchy,
  useModules,
  useTasks,
  useUpdateTask,
  type Task,
} from "@/features/tasks";
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
import { DependencyLayer } from "./dependency-layer";
import { GanttBar, type ReschedulePatch } from "./gantt-bar";
import { UnscheduledPanel } from "./unscheduled-panel";

const ZOOMS: Zoom[] = ["day", "week", "month"];
const NAME_COL = 220;
const HEADER_H = 32;
// One indent step per subtask depth (1 level only), on top of the name
// column's own inset — mirrors the task list's pl-10 (12px base + 24px step).
const NAME_INDENT_BASE = 12;
const NAME_INDENT_STEP = 24;

interface Row {
  kind: "module" | "task";
  id: string;
  name: string;
  task?: Task;
  span?: { start: Date; end: Date };
  /** 0 = top-level, 1 = subtask. Modules are always 0. */
  depth: number;
}

export function GanttChart({ projectId }: { projectId: string }) {
  const { modules, isLoading: ml } = useModules(projectId);
  const { tasks, isLoading: tl } = useTasks(projectId);
  const update = useUpdateTask(projectId);
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
      const mt = byModule[m.id] ?? [];
      if (mt.length === 0) continue;
      // Hierarchy scoped to this module's *scheduled* tasks: buildHierarchy's
      // `roots` only covers tasks with no parentId. A subtask whose parent
      // isn't itself scheduled would otherwise vanish rather than nest under
      // it — `orphaned` promotes it back to the top level instead.
      const { roots, childrenOf } = buildHierarchy(mt);
      const scheduledIds = new Set(mt.map((t) => t.id));
      const orphaned = mt.filter((t) => t.parentId && !scheduledIds.has(t.parentId));
      const topLevel = [...roots, ...orphaned].sort((a, b) => a.order - b.order);

      rowList.push({ kind: "module", id: m.id, name: m.name, depth: 0 });
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
    return { rows: rowList, unscheduled: unsched };
  }, [modules, tasks]);

  // taskId → y offset of its row, for the dependency overlay. Rows (module
  // headers included) are all ROW_HEIGHT tall and stack directly under the
  // header, so the index alone gives the offset — no separate layout pass.
  const rowTop = useMemo(() => {
    const out: Record<string, number> = {};
    rows.forEach((r, i) => {
      if (r.kind === "task") out[r.id] = HEADER_H + i * ROW_HEIGHT;
    });
    return out;
  }, [rows]);
  const gridHeight = HEADER_H + rows.length * ROW_HEIGHT;

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

  function reschedule(taskId: string, patch: ReschedulePatch) {
    update.mutate({ id: taskId, ...patch });
  }
  function schedule(taskId: string, date: Date) {
    const iso = toIso(date);
    update.mutate({ id: taskId, startDate: iso, dueDate: iso });
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
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={measure}
            className="scrollbar-slim overflow-x-auto rounded-xl bg-surface-raised shadow-2"
          >
            {/* w-max: tanpa ini flex item menyusut ke lebar viewport dan latar
                baris modul berhenti di tengah grid — hanya tick absolut yang
                ikut men-scroll. */}
            <div className="flex w-max">
              {/* Left: names — sticky supaya nama baris tidak ikut hilang saat
                  grid di-scroll ke kanan; tanpa ini bar melayang tanpa label
                  dan grid berhenti bisa dibaca persis saat mulai dipakai.

                  URUTAN LAPIS grid ini, dipakai bersama gantt-bar.tsx dan
                  dependency-layer.tsx:
                    z-auto  gridline, latar baris, label tanggal
                    z-10    fade tepi kanan     — meredam grid, bukan bar
                    z-15    DependencyLayer     — di atas fade (panah konflik
                                                   tetap pekat sampai tepi),
                                                   di bawah bar (ujung panah
                                                   masuk ke bawah tepi bar)
                    z-20    GanttBar            — tetap pekat sampai tepi kartu
                    z-30    kolom nama          — menang atas semuanya
                  Angka eksplisit wajib: `overflow-x` TIDAK membuat stacking
                  context, jadi ketiganya beradu di context yang sama dan
                  urutan DOM saja tidak cukup — elemen ber-z-index selalu
                  menang atas elemen z-auto berapa pun posisinya di DOM. */}
              <div
                className={cn(
                  "sticky left-0 z-30 shrink-0 bg-surface-raised border-r",
                  "transition-colors [transition-duration:var(--duration)]",
                  // Dua bobot, dua token — kosakata yang sama dengan gridline
                  // di bawah. Saat kolom ini benar-benar menimpa grid, ia naik
                  // dari pemisah halus jadi landmark; occlusion sendirian tidak
                  // terbaca karena dua sisi memakai --surface-raised yang sama
                  // (depth.md §5).
                  edge.start ? "border-border-strong" : "border-border-subtle",
                )}
                style={{ width: NAME_COL }}
              >
                <div
                  style={{ height: HEADER_H }}
                  className="border-b border-border-subtle"
                />
                {rows.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      height: ROW_HEIGHT,
                      // Subtasks get one extra indent step, same idea as the
                      // task list's pl-10 — px-3's own 12px plus a 24px step.
                      paddingLeft: r.depth
                        ? NAME_INDENT_BASE + r.depth * NAME_INDENT_STEP
                        : undefined,
                    }}
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
              <div className="relative shrink-0" style={{ width: gridWidth }}>
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
                      // Mayor memakai --border-STRONG, bukan --border: di dark
                      // --border dan --surface-raised dua-duanya grey-800,
                      // jadi garis landmark justru HILANG persis di tema yang
                        // paling membutuhkannya. --border-strong 3.86 light /
                        // 4.57 dark; --border-subtle 1.14 / 1.86.
                        t.major
                          ? "border-border-strong"
                          : "border-border-subtle",
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
                          t.major
                            ? "border-border-strong"
                            : "border-border-subtle",
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
                        conflict={conflictTaskIds.has(r.task.id)}
                      />
                    )}
                  </div>
                ))}
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
              Tanpa ini scroll horizontal hanya ketahuan kalau kebetulan dicoba,
              karena scrollbar slim nyaris tak terlihat saat diam. Menghilang
              saat sudah mentok kanan — penanda yang selalu menyala berhenti
              jadi penanda.
              z-10: DI BAWAH bar (lihat urutan lapis di atas). Yang diredam
              adalah grid; bar yang masih berlanjut tetap pekat dan terpotong
              tegas di tepi kartu, karena bar-lah datanya — memudarkannya
              membuat task terbaca seolah selesai lebih awal. */}
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
        canEdit={canEdit}
        onSchedule={schedule}
      />
    </div>
  );
}
