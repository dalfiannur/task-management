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
    <span className="text-num text-xs text-text-muted">
      {sign}
      {diff} vs previous ({before})
    </span>
  );
}

/** Four totals, two of which carry a delta against the previous window.
 *
 *  The delta row shares the totals row's grid (`sm:grid-cols-2 lg:grid-cols-4`)
 *  so its two blanks land under the cards that have no delta rather than
 *  merely padding the row out: `grid-cols-N` divides the container into N
 *  equal fractional tracks, so both grids — same order, same column count —
 *  line up column-for-column at every breakpoint the grid uses. */
export function ReportTotals({
  totals,
  prev,
}: {
  totals: PeriodTotals;
  prev: PeriodTotals | null;
}) {
  return (
    <div className="space-y-3 print:break-inside-avoid">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Completed" value={totals.completed} />
        <StatCard icon={Plus} label="Created" value={totals.created} />
        <StatCard icon={ListTodo} label="Still open" value={totals.stillOpen} />
        <StatCard icon={AlertTriangle} label="Overdue" value={totals.overdue} alert />
      </div>
      {prev && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Delta now={totals.completed} before={prev.completed} />
          <Delta now={totals.created} before={prev.created} />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
