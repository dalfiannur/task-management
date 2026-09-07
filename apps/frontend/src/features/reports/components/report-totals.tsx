import { AlertTriangle, CheckCircle2, ListTodo, Plus } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import type { PeriodTotals } from "../types";

/** The delta line under a period quantity.
 *
 *  Only `completed` and `created` get one: they are quantities *of the window*,
 *  so a previous window is a like-for-like comparison. `stillOpen` and
 *  `overdue` are today's backlog under both windows — comparing them would
 *  always read zero and imply nothing changed. */
function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  const diff = now - before;
  const sign = diff > 0 ? "+" : "";
  return (
    <p className="text-num text-xs text-text-muted">
      {sign}
      {diff} vs previous ({before})
    </p>
  );
}

/** Four totals, two of which carry a delta against the previous window.
 *
 *  The delta for a stat lives in that stat's own grid cell, stacked beneath
 *  its `StatCard`, rather than in a second grid row underneath the whole
 *  totals grid. Two sibling grids don't interleave: the first grid's box
 *  renders in full — every row it wraps to — before the second one begins, so
 *  a second grid meant to line up under specific cards only does so at the
 *  breakpoint where the first grid doesn't wrap (here, only `lg`). Putting the
 *  delta inside the same cell as its stat means there is no row-wrap parity to
 *  keep in sync in the first place. */
export function ReportTotals({
  totals,
  prev,
}: {
  totals: PeriodTotals;
  prev: PeriodTotals | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:break-inside-avoid">
      <div className="space-y-2">
        <StatCard icon={CheckCircle2} label="Completed" value={totals.completed} />
        {prev && <Delta now={totals.completed} before={prev.completed} />}
      </div>
      <div className="space-y-2">
        <StatCard icon={Plus} label="Created" value={totals.created} />
        {prev && <Delta now={totals.created} before={prev.created} />}
      </div>
      <div className="space-y-2">
        <StatCard icon={ListTodo} label="Still open" value={totals.stillOpen} />
      </div>
      <div className="space-y-2">
        <StatCard icon={AlertTriangle} label="Overdue" value={totals.overdue} alert />
      </div>
    </div>
  );
}
