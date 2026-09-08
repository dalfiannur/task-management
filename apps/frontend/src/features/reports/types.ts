// Flat FE types for the periodic reports domain, mapped from gen/reports_pb.

import type { MyTaskItem } from "@/features/dashboard";
import type { ActivityAction, ActivityEntity } from "@/features/activity";

export type Granularity = "weekly" | "monthly";

/** A resolved period: the window to ask for, and how to name it. */
export interface PeriodWindow {
  granularity: Granularity;
  /** 0 = the period in progress, -1 = the one before it. Never positive. */
  offset: number;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  /** The same bounds as local calendar dates (yyyy-MM-dd), for the task fields
   *  that are plain dates rather than instants. They cannot be derived from the
   *  instants above: those are local midnight expressed in UTC, so at UTC+7 the
   *  week beginning Monday carries the *previous* day's date prefix. */
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  label: string;
  isCurrent: boolean;
}

/** `completed`/`started` are of the window; `stillOpen`/`overdue` are of now.
 *
 *  `started` keys on the task's `startDate` — when the work was scheduled to
 *  begin. A task with no start date falls back to when it was created, so
 *  nothing drops out of the report; the cost is that the number mixes two
 *  meanings. */
export interface PeriodTotals {
  completed: number;
  started: number;
  stillOpen: number;
  overdue: number;
}

export interface ProjectReportRow {
  projectId: string;
  projectName: string;
  completed: number;
  started: number;
  stillOpen: number;
  overdue: number;
  doneTotal: number;
  total: number;
}

export interface MemberReportRow {
  userId: string;
  userName: string;
  completed: number;
  started: number;
  openAssigned: number;
  overdueAssigned: number;
}

export interface ActivitySummaryRow {
  entity: ActivityEntity;
  action: ActivityAction;
  count: number;
}

export interface PeriodReport {
  periodStart: string;
  periodEnd: string;
  totals: PeriodTotals;
  prevTotals: PeriodTotals | null;
  perProject: ProjectReportRow[];
  perMember: MemberReportRow[];
  completedTasks: MyTaskItem[];
  completedTruncated: boolean;
  overdueTasks: MyTaskItem[];
  overdueTruncated: boolean;
  activitySummary: ActivitySummaryRow[];
  activityTotal: number;
}
