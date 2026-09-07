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
  label: string;
  isCurrent: boolean;
}

/** `completed`/`created` are of the window; `stillOpen`/`overdue` are of now. */
export interface PeriodTotals {
  completed: number;
  created: number;
  stillOpen: number;
  overdue: number;
}

export interface ProjectReportRow {
  projectId: string;
  projectName: string;
  completed: number;
  created: number;
  stillOpen: number;
  overdue: number;
  doneTotal: number;
  total: number;
}

export interface MemberReportRow {
  userId: string;
  userName: string;
  completed: number;
  created: number;
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
