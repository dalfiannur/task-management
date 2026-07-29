// Pure projection helpers for the Gantt. One positioning model: pixels-per-day.
// Zoom just changes the density (px/day) + header labelling — bars are always
// positioned by day offset, which keeps the math correct across scales.

import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  parseISO,
} from "date-fns";
import type { Task } from "@/features/tasks";

export type Zoom = "day" | "week" | "month";

/** Pixels per day for each zoom level. */
export const PX_PER_DAY: Record<Zoom, number> = {
  day: 40,
  week: 14,
  month: 5,
};

export const ROW_HEIGHT = 36;
export const DEFAULT_DURATION_DAYS = 1;

export interface DateRange {
  start: Date;
  end: Date;
}

/** A task's effective bar span. Null when it has no dates (→ Unscheduled). */
export function effectiveSpan(task: Task): { start: Date; end: Date } | null {
  const s = task.startDate ? parseISO(task.startDate) : undefined;
  const d = task.dueDate ? parseISO(task.dueDate) : undefined;
  if (!s && !d) return null;
  const start = s ?? d!;
  const end = d ?? s!;
  return start <= end ? { start, end } : { start: end, end: start };
}

export function isScheduled(task: Task): boolean {
  return !!task.startDate || !!task.dueDate;
}

/** Window spanning all scheduled tasks + padding; ±2 weeks around today if none. */
export function computeRange(tasks: Task[], today: Date): DateRange {
  const spans = tasks.map(effectiveSpan).filter(Boolean) as {
    start: Date;
    end: Date;
  }[];
  if (spans.length === 0) {
    return { start: addDays(today, -14), end: addDays(today, 14) };
  }
  let min = spans[0].start;
  let max = spans[0].end;
  for (const s of spans) {
    if (s.start < min) min = s.start;
    if (s.end > max) max = s.end;
  }
  return { start: addDays(min, -3), end: addDays(max, 7) };
}

export function rangeDays(range: DateRange): Date[] {
  return eachDayOfInterval({ start: range.start, end: range.end });
}

export function dayOffset(date: Date, rangeStart: Date): number {
  return differenceInCalendarDays(date, rangeStart);
}

/** Left/width in px for a task's bar within the range. */
export function barGeometry(
  span: { start: Date; end: Date },
  rangeStart: Date,
  pxPerDay: number,
): { left: number; width: number } {
  const startOff = dayOffset(span.start, rangeStart);
  const endOff = dayOffset(span.end, rangeStart);
  return {
    left: startOff * pxPerDay,
    width: (endOff - startOff + 1) * pxPerDay,
  };
}

export interface Tick {
  offset: number; // day offset from range start
  label: string;
  major: boolean; // major gridline (month/week boundary)
}

/** Header ticks for the current zoom. */
export function buildTicks(range: DateRange, zoom: Zoom): Tick[] {
  const days = rangeDays(range);
  const ticks: Tick[] = [];
  days.forEach((d, i) => {
    if (zoom === "day") {
      ticks.push({ offset: i, label: format(d, "d"), major: d.getDate() === 1 });
    } else if (zoom === "week") {
      if (d.getDay() === 1) {
        ticks.push({ offset: i, label: format(d, "MMM d"), major: d.getDate() <= 7 });
      }
    } else {
      if (d.getDate() === 1) {
        ticks.push({ offset: i, label: format(d, "MMM yyyy"), major: true });
      }
    }
  });
  return ticks;
}

export function toIso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export { addDays };
