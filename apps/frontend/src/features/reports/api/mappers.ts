import type {
  PeriodReport as PbReport,
  PeriodTotals as PbTotals,
  ProjectReportRow as PbProjectRow,
  MemberReportRow as PbMemberRow,
  ActivitySummaryRow as PbActivityRow,
} from "@/lib/gen/reports_pb";
import { mapMyTasks } from "@/features/dashboard";
import { mapAction, mapEntity } from "@/features/activity";
import type {
  ActivitySummaryRow,
  MemberReportRow,
  PeriodReport,
  PeriodTotals,
  ProjectReportRow,
} from "../types";

const ZERO: PeriodTotals = {
  completed: 0,
  created: 0,
  stillOpen: 0,
  overdue: 0,
};

function mapTotals(t: PbTotals): PeriodTotals {
  return {
    completed: t.completed,
    created: t.created,
    stillOpen: t.stillOpen,
    overdue: t.overdue,
  };
}

function mapProjectRow(p: PbProjectRow): ProjectReportRow {
  return {
    projectId: p.projectId,
    projectName: p.projectName,
    completed: p.completed,
    created: p.created,
    stillOpen: p.stillOpen,
    overdue: p.overdue,
    doneTotal: p.doneTotal,
    total: p.total,
  };
}

function mapMemberRow(m: PbMemberRow): MemberReportRow {
  return {
    userId: m.userId,
    userName: m.userName,
    completed: m.completed,
    created: m.created,
    openAssigned: m.openAssigned,
    overdueAssigned: m.overdueAssigned,
  };
}

function mapActivityRow(a: PbActivityRow): ActivitySummaryRow {
  return {
    entity: mapEntity(a.entityType),
    action: mapAction(a.action),
    count: a.count,
  };
}

/** Absent `prevTotals` stays null, never zeros: zeros would render as a real
 *  "−100%" delta against a period that was simply never asked about. */
export function mapReport(r: PbReport): PeriodReport {
  return {
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    totals: r.totals ? mapTotals(r.totals) : ZERO,
    prevTotals: r.prevTotals ? mapTotals(r.prevTotals) : null,
    perProject: r.perProject.map(mapProjectRow),
    perMember: r.perMember.map(mapMemberRow),
    completedTasks: mapMyTasks(r.completedTasks),
    completedTruncated: r.completedTruncated,
    overdueTasks: mapMyTasks(r.overdueTasks),
    overdueTruncated: r.overdueTruncated,
    activitySummary: r.activitySummary.map(mapActivityRow),
    activityTotal: r.activityTotal,
  };
}
