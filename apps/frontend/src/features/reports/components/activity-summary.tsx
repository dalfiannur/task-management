import { Link } from "@tanstack/react-router";
import { ACTION_LABEL, ENTITY_LABEL } from "../lib/activity-labels";
import type { ActivitySummaryRow } from "../types";

/** Counts, not rows. A month of activity is thousands of entries; the feed is
 *  where those belong, and this links to it. */
export function ActivitySummary({
  rows,
  total,
}: {
  rows: ActivitySummaryRow[];
  total: number;
}) {
  if (total === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        No recorded activity in this period.
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-surface-raised p-4 shadow-2 print:break-inside-avoid">
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li
            key={`${r.entity}-${r.action}`}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="text-text-muted">
              {ENTITY_LABEL[r.entity]} {ACTION_LABEL[r.action]}
            </span>
            <span className="text-num font-medium">{r.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-text-muted">
        {total} recorded changes.{" "}
        <Link to="/dashboard" className="text-brand-text underline print:hidden">
          See the activity feed
        </Link>
      </p>
    </div>
  );
}
