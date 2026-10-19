import {
  CalendarScope as PbScope,
  WorkloadBucket as PbBucket,
  type WorkCalendar as PbCalendar,
  type Workload as PbWorkload,
} from "@/lib/gen/workload_pb";
import type { CalendarScope, WorkCalendar, Workload, WorkloadBucket } from "../types";

const SCOPE_TO_PROTO: Record<CalendarScope, PbScope> = {
  global: PbScope.GLOBAL,
  project: PbScope.PROJECT,
  user: PbScope.USER,
};

export function scopeToProto(s: CalendarScope): PbScope {
  return SCOPE_TO_PROTO[s];
}

function scopeFromProto(s: PbScope): CalendarScope {
  if (s === PbScope.PROJECT) return "project";
  if (s === PbScope.USER) return "user";
  return "global";
}

function bucketFromProto(b: PbBucket): WorkloadBucket {
  if (b === PbBucket.OVERDUE) return "overdue";
  if (b === PbBucket.UNSCHEDULED) return "unscheduled";
  return "scheduled";
}

export function mapCalendar(c: PbCalendar): WorkCalendar {
  return {
    scope: scopeFromProto(c.scope),
    id: c.id,
    workingDays: [...c.workingDays],
    effectiveDays: [...c.effectiveDays],
    weeklyMinutes: c.weeklyMinutes,
    effectiveWeeklyMinutes: c.effectiveWeeklyMinutes,
    canEdit: c.canEdit,
    timezone: c.timezone,
    supportedTimezones: [...c.supportedTimezones],
  };
}

export function mapWorkload(w: PbWorkload): Workload {
  return {
    weekStarts: [...w.weekStarts],
    projects: w.projects.map((p) => ({ id: p.id, name: p.name })),
    members: w.members.map((m) => ({
      userId: m.userId,
      userName: m.userName,
      avatarUrl: m.avatarUrl,
      weeklyMinutes: m.weeklyMinutes,
      workingDays: [...m.workingDays],
      weeks: m.weeks.map((wk) => ({
        capacityMinutes: wk.capacityMinutes,
        plannedMinutes: wk.plannedMinutes,
      })),
      overdueMinutes: m.overdueMinutes,
      unscheduledMinutes: m.unscheduledMinutes,
      laterMinutes: m.laterMinutes,
      totalMinutes: m.totalMinutes,
      calendarConflict: m.calendarConflict,
      tasks: m.tasks.map((t) => ({
        taskId: t.taskId,
        projectId: t.projectId,
        projectName: t.projectName,
        number: t.number,
        title: t.title,
        remainingMinutes: t.remainingMinutes,
        startDate: t.startDate,
        dueDate: t.dueDate,
        bucket: bucketFromProto(t.bucket),
        calendarConflict: t.calendarConflict,
      })),
    })),
  };
}
