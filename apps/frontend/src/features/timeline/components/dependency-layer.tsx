import { useMemo } from "react";
import { edgeConflicts, type ConflictKind, type Task } from "@/features/tasks";
import { ROW_HEIGHT, barGeometry, effectiveSpan, isScheduled } from "../timeline-utils";

// One dependency arrow per `blockedByIds` entry, routed from the blocker's
// bar end to the dependent's bar start.
//
// Routing: every edge — ordinary or conflicting — is drawn with the SAME
// four-corner shape: leave the blocker's end going right, drop to the row
// boundary just past the blocker's row (a strip that is always empty, since
// bars sit inset within their row), travel across at that safe height, then
// rise/fall into the dependent's row and approach its start from the LEFT
// with one final short rightward hop.
//
// That last hop is the whole point: because it always runs left-to-right,
// the arrowhead (`orient="auto"`) always points rightward into the bar,
// exactly like an ordinary forward edge. A dependent that starts before its
// blocker finishes — the conflict case, and the one that matters most — asks
// this same formula to travel a fair distance right of the blocker and loop
// back left past the dependent's start before making that final approach.
// The alternative (a straight line from end to start) draws the conflict
// edge backwards across the chart; it reads as a rendering glitch, not the
// warning it's meant to be. This shape reads as "these two are linked, and
// something is wrong with the order" instead.
//
// At realistic project sizes (dozens of tasks, several dependency edges)
// this stays legible: each edge is its own gently-curved path, conflicts are
// the only ones drawn in the alarming color, and the safe-boundary detour
// keeps most lines clear of unrelated bars. It has not been stress-tested
// against a task with many dozens of *incoming* edges landing on one row —
// that many arrows converging on a single bar would start to overlap
// regardless of routing, and nothing here tries to fan them out.

// Off the 4/8/12/16/24… spacing scale on purpose: these size an SVG path,
// not a layout gap, and need to stay small relative to ROW_HEIGHT (36).
const GAP = 14; // px an edge travels clear of a bar before turning
const CORNER_RADIUS = 6; // px of rounding at each turn
const ARROW_MARKER = "dependency-arrow";
const CONFLICT_MARKER = "dependency-arrow-conflict";

interface Edge {
  id: string;
  blocker: Task;
  dependent: Task;
  kinds: ConflictKind[];
}

export function DependencyLayer({
  tasks,
  rowTop,
  rangeStart,
  pxPerDay,
  width,
  height,
}: {
  tasks: Task[];
  /** taskId → the row's y offset in px. Absent = that task has no visible row. */
  rowTop: Record<string, number>;
  rangeStart: Date;
  pxPerDay: number;
  width: number;
  height: number;
}) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const edges = useMemo(() => {
    const out: Edge[] = [];
    for (const dependent of tasks) {
      if (!isScheduled(dependent) || !(dependent.id in rowTop)) continue;
      for (const blockerId of dependent.blockedByIds) {
        const blocker = byId.get(blockerId);
        // Deleted mid-session (the backend strips the dangling id on
        // delete) or simply not on a visible row right now — either way,
        // there is nowhere to anchor an arrow, so skip it rather than guess.
        if (!blocker || !isScheduled(blocker) || !(blockerId in rowTop)) continue;
        out.push({
          id: `${blockerId}->${dependent.id}`,
          blocker,
          dependent,
          kinds: edgeConflicts(blocker, dependent),
        });
      }
    }
    return out;
  }, [tasks, byId, rowTop]);

  if (edges.length === 0) return null;

  return (
    <svg
      // Overlay only, never an interaction target: the bars beneath already
      // own drag-to-reschedule, and a hit-testable SVG on top would swallow
      // those pointer events.
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
      aria-hidden
    >
      <defs>
        <marker
          id={ARROW_MARKER}
          viewBox="0 0 8 8"
          refX={7}
          refY={4}
          markerWidth={6}
          markerHeight={6}
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-border-strong" />
        </marker>
        <marker
          id={CONFLICT_MARKER}
          viewBox="0 0 8 8"
          refX={7}
          refY={4}
          markerWidth={7}
          markerHeight={7}
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-danger" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const bSpan = effectiveSpan(edge.blocker)!;
        const dSpan = effectiveSpan(edge.dependent)!;
        const bGeom = barGeometry(bSpan, rangeStart, pxPerDay);
        const dGeom = barGeometry(dSpan, rangeStart, pxPerDay);
        const sx = bGeom.left + bGeom.width;
        const sy = rowTop[edge.blocker.id] + ROW_HEIGHT / 2;
        const tx = dGeom.left;
        const ty = rowTop[edge.dependent.id] + ROW_HEIGHT / 2;
        const conflict = edge.kinds.length > 0;
        return (
          <path
            key={edge.id}
            d={edgePath(sx, sy, tx, ty)}
            fill="none"
            className={conflict ? "stroke-danger" : "stroke-border-strong"}
            strokeWidth={conflict ? 2 : 1.5}
            strokeDasharray={conflict ? undefined : "3 3"}
            markerEnd={`url(#${conflict ? CONFLICT_MARKER : ARROW_MARKER})`}
          />
        );
      })}
    </svg>
  );
}

/** The routing described above, as an SVG path with rounded corners. */
function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const exitX = sx + GAP;
  const entryX = tx - GAP;
  const vDir = ty >= sy ? 1 : -1;
  // The boundary between the blocker's row and its next row toward the
  // dependent: always clear of bar content, whichever direction this runs.
  const boundaryY = sy + vDir * (ROW_HEIGHT / 2);
  return roundedOrthogonalPath(
    [
      [sx, sy],
      [exitX, sy],
      [exitX, boundaryY],
      [entryX, boundaryY],
      [entryX, ty],
      [tx, ty],
    ],
    CORNER_RADIUS,
  );
}

/** An axis-aligned polyline with each internal corner rounded by up to `r`,
 *  clamped so a short segment never overshoots into its neighbour. */
function roundedOrthogonalPath(points: [number, number][], r: number): string {
  const [first, ...rest] = points;
  const segs = [`M${first[0]},${first[1]}`];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const dIn = Math.min(r, Math.hypot(cx - px, cy - py) / 2);
    const dOut = Math.min(r, Math.hypot(nx - cx, ny - cy) / 2);
    const inX = cx - Math.sign(cx - px) * dIn;
    const inY = cy - Math.sign(cy - py) * dIn;
    const outX = cx + Math.sign(nx - cx) * dOut;
    const outY = cy + Math.sign(ny - cy) * dOut;
    segs.push(`L${inX},${inY}`, `Q${cx},${cy} ${outX},${outY}`);
  }
  const last = rest[rest.length - 1] ?? first;
  segs.push(`L${last[0]},${last[1]}`);
  return segs.join(" ");
}
