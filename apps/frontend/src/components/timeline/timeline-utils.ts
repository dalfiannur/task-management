import {
  differenceInCalendarDays,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  subDays,
  addDays,
  format,
  isWeekend,
  isSameDay,
} from "date-fns";
import type { Task, Module } from "@/types/task";

export const DAY_WIDTH = 40;
export const ROW_HEIGHT = 40;

export interface TimelineRange {
  start: Date;
  end: Date;
  days: Date[];
}

export type TimelineRow =
  | { type: "module"; module: Module; taskCount: number; colorIndex: number }
  | { type: "task"; task: Task; colorIndex: number };

export interface WeekGroup {
  weekStart: Date;
  days: Date[];
}

export interface BarPosition {
  left: number;
  width: number;
}

export function computeTimelineRange(tasks: Task[]): TimelineRange {
  const tasksWithDates = tasks.filter((t) => t.startDate || t.dueDate);

  if (tasksWithDates.length === 0) {
    const today = new Date();
    const start = startOfWeek(subDays(today, 14), { weekStartsOn: 1 });
    const end = endOfWeek(addDays(today, 14), { weekStartsOn: 1 });
    return { start, end, days: eachDayOfInterval({ start, end }) };
  }

  let minDate = new Date(8640000000000000);
  let maxDate = new Date(-8640000000000000);

  for (const t of tasksWithDates) {
    if (t.startDate) {
      const d = new Date(t.startDate);
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
    if (t.dueDate) {
      const d = new Date(t.dueDate);
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
  }

  const start = startOfWeek(subDays(minDate, 7), { weekStartsOn: 1 });
  const end = endOfWeek(addDays(maxDate, 14), { weekStartsOn: 1 });

  return { start, end, days: eachDayOfInterval({ start, end }) };
}

export function computeBarPosition(
  task: Task,
  timelineStart: Date,
): BarPosition | null {
  if (!task.startDate || !task.dueDate) return null;

  const start = new Date(task.startDate);
  const end = new Date(task.dueDate);

  const left = differenceInCalendarDays(start, timelineStart) * DAY_WIDTH;
  const span = differenceInCalendarDays(end, start) + 1;
  const width = span * DAY_WIDTH;

  return { left, width };
}

export function groupDaysByWeek(days: Date[]): WeekGroup[] {
  const weeks: WeekGroup[] = [];
  let current: WeekGroup | null = null;

  for (const day of days) {
    const ws = startOfWeek(day, { weekStartsOn: 1 });
    if (!current || !isSameDay(current.weekStart, ws)) {
      current = { weekStart: ws, days: [] };
      weeks.push(current);
    }
    current.days.push(day);
  }

  return weeks;
}

export function formatDateRange(startDate?: string, dueDate?: string): string {
  if (!startDate && !dueDate) return "\u2014";
  const s = startDate ? format(new Date(startDate), "MMM d") : "?";
  const e = dueDate ? format(new Date(dueDate), "MMM d") : "?";
  return `${s} - ${e}`;
}

export { isWeekend, isSameDay, format };
