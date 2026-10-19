// Flat FE types for the workload domain, mapped from gen/workload_pb.

export type CalendarScope = "global" | "project" | "user";

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WorkCalendar {
  scope: CalendarScope;
  id: string;
  /** Own setting; empty = inherits the global days. */
  workingDays: number[];
  effectiveDays: number[];
  /** Users only; undefined = the default. */
  weeklyMinutes?: number;
  effectiveWeeklyMinutes: number;
  canEdit: boolean;
  /** Global only: the workspace IANA time zone ("today" everywhere). */
  timezone?: string;
  /** Global only: every zone the server accepts. */
  supportedTimezones: string[];
}

export type WorkloadBucket = "scheduled" | "overdue" | "unscheduled";

export interface WorkloadTask {
  taskId: string;
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  /** This member's share. */
  remainingMinutes: number;
  startDate?: string;
  dueDate?: string;
  bucket: WorkloadBucket;
  calendarConflict: boolean;
}

export interface WorkloadWeek {
  capacityMinutes: number;
  plannedMinutes: number;
}

export interface WorkloadMember {
  userId: string;
  userName: string;
  avatarUrl: string;
  weeklyMinutes: number;
  workingDays: number[];
  /** One per `Workload.weekStarts`. */
  weeks: WorkloadWeek[];
  overdueMinutes: number;
  unscheduledMinutes: number;
  laterMinutes: number;
  totalMinutes: number;
  calendarConflict: boolean;
  tasks: WorkloadTask[];
}

export interface Workload {
  weekStarts: string[];
  members: WorkloadMember[];
  projects: { id: string; name: string }[];
}

export const WEEKDAYS: { day: Weekday; short: string; label: string }[] = [
  { day: 1, short: "Mon", label: "Monday" },
  { day: 2, short: "Tue", label: "Tuesday" },
  { day: 3, short: "Wed", label: "Wednesday" },
  { day: 4, short: "Thu", label: "Thursday" },
  { day: 5, short: "Fri", label: "Friday" },
  { day: 6, short: "Sat", label: "Saturday" },
  { day: 7, short: "Sun", label: "Sunday" },
];

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 0) return "No days";
  const short = (d: number) => WEEKDAYS[d - 1].short;
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) return `${short(sorted[0])}–${short(sorted[sorted.length - 1])}`;
  return sorted.map(short).join(", ");
}
