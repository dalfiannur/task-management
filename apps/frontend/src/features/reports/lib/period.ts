// All calendar arithmetic for the report lives here, in the browser, in the
// viewer's local time. The server is sent two instants and never asked what a
// week is — see the spec's "the client owns the calendar" decision.

import {
  addMonths,
  addWeeks,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import type { Granularity, PeriodWindow } from "../types";

/**
 * Resolve a granularity + offset into a half-open `[start, end)` window and its
 * comparison window.
 *
 * The previous window is a calendar step back, not a fixed number of days:
 * February is 28 days and March is 31, so "minus 30 days" would compare a month
 * against something that is not a month.
 */
export function periodWindow(
  granularity: Granularity,
  offset: number,
  now: Date = new Date(),
): PeriodWindow {
  const weekly = granularity === "weekly";
  const start = weekly
    ? addWeeks(startOfWeek(now, { weekStartsOn: 1 }), offset)
    : addMonths(startOfMonth(now), offset);
  const end = weekly ? addWeeks(start, 1) : addMonths(start, 1);
  const prevStart = weekly ? addWeeks(start, -1) : addMonths(start, -1);

  // The label names the days the period covers, so it ends on the last day
  // inside it — not on the exclusive bound, which belongs to the next period.
  const lastDay = subDays(end, 1);
  // A week within one month reads as "7 – 13 Sep 2026" — the month name on the
  // start day would just repeat the one at the end. A week that crosses a month
  // boundary (including a year boundary, e.g. 28 Dec – 3 Jan) needs it on both
  // sides to stay unambiguous. No year check is needed here: the window is at
  // most 6 days, so a year change always flips December(11) to January(0) —
  // the month comparison alone already catches it.
  const sameMonth = start.getMonth() === lastDay.getMonth();
  const label = weekly
    ? `${format(start, sameMonth ? "d" : "d MMM")} – ${format(lastDay, "d MMM yyyy")}`
    : format(start, "MMMM yyyy");

  // The same bounds as plain calendar dates, for `start_date` on a task — which
  // is a local date with no time and no zone. These are formatted from the same
  // local `Date`s above, NOT derived server-side from the instants: an instant
  // is local midnight expressed in UTC, so at UTC+7 the Monday-starting week
  // travels as `…-06T17:00:00` and its date prefix is the previous day.
  const asDate = (d: Date) => format(d, "yyyy-MM-dd");

  return {
    granularity,
    offset,
    start,
    end,
    prevStart,
    prevEnd: start,
    startDate: asDate(start),
    endDate: asDate(end),
    prevStartDate: asDate(prevStart),
    prevEndDate: asDate(start),
    label,
    isCurrent: offset === 0,
  };
}
