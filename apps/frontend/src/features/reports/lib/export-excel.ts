// Build and download the period report as an .xlsx workbook — one sheet per
// section of the page. ExcelJS is ~1 MB, so it is imported on click rather than
// shipped with the reports route.

import type { Workbook, Worksheet } from "exceljs";
import type { MyTaskItem } from "@/features/dashboard";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "@/features/tasks";
import { APP_NAME } from "@/lib/app-config";
import type { PeriodReport, PeriodWindow } from "../types";
import { ACTION_LABEL, ENTITY_LABEL } from "./activity-labels";

const DATE_FMT = "dd mmm yyyy";
const DATETIME_FMT = "dd mmm yyyy hh:mm";

/** Excel stores wall-clock time with no zone, and ExcelJS writes a `Date` by
 *  its UTC fields. Re-express the viewer's local wall clock as UTC so the cell
 *  shows the time the viewer saw on the page, not the UTC one. */
function wallClock(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
    ),
  );
}

/** A task's `startDate`/`dueDate` is a plain calendar date (yyyy-MM-dd), not an
 *  instant — build it straight in UTC so no zone shifts it by a day. */
function plainDate(value?: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function instant(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : wallClock(d);
}

function addTable(
  ws: Worksheet,
  columns: { header: string; key: string; width: number; numFmt?: string }[],
  rows: Record<string, unknown>[],
) {
  ws.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  ws.addRows(rows);
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const c of columns) {
    if (c.numFmt) ws.getColumn(c.key).numFmt = c.numFmt;
  }
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    };
  }
}

function addTaskSheet(
  wb: Workbook,
  name: string,
  items: MyTaskItem[],
  truncated: boolean,
) {
  const ws = wb.addWorksheet(name);
  addTable(
    ws,
    [
      { header: "Title", key: "title", width: 48 },
      { header: "Project", key: "project", width: 24 },
      { header: "Module", key: "module", width: 20 },
      { header: "Status", key: "status", width: 14 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Start date", key: "start", width: 14, numFmt: DATE_FMT },
      { header: "Due date", key: "due", width: 14, numFmt: DATE_FMT },
      { header: "Completed at", key: "completed", width: 20, numFmt: DATETIME_FMT },
    ],
    items.map(({ task, projectName, moduleName }) => ({
      title: task.title,
      project: projectName,
      module: moduleName,
      status: TASK_STATUS_CONFIG[task.status]?.label ?? task.status,
      priority: TASK_PRIORITY_CONFIG[task.priority]?.label ?? task.priority,
      start: plainDate(task.startDate),
      due: plainDate(task.dueDate),
      completed: instant(task.completedAt),
    })),
  );
  if (truncated) {
    ws.addRow([]);
    ws.addRow([
      `Showing the first ${items.length} only. The totals on the Summary sheet are complete.`,
    ]).font = { italic: true };
  }
}

export async function exportReportExcel(
  report: PeriodReport,
  window: PeriodWindow,
  userName?: string,
) {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const now = new Date();
  wb.creator = userName || APP_NAME;
  wb.created = now;

  const kind = window.granularity === "weekly" ? "Weekly" : "Monthly";

  // Summary — what this is, the period it covers, and when it was taken.
  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 22 }, { width: 16 }, { width: 18 }];
  summary.addRow([`${kind} report`]).font = { bold: true, size: 14 };
  summary.addRow(["Period", window.label]);
  summary.addRow(["Generated", wallClock(now)]).getCell(2).numFmt = DATETIME_FMT;
  if (userName) summary.addRow(["By", userName]);
  summary.addRow(["App", APP_NAME]);
  summary.addRow([]);
  const head = summary.addRow(["Metric", "This period", "Previous period"]);
  head.font = { bold: true };
  const prev = report.prevTotals;
  // Only the quantities of the window have a like-for-like previous value; the
  // backlog numbers are "now" under both windows (see ReportTotals).
  summary.addRow(["Completed", report.totals.completed, prev?.completed ?? null]);
  summary.addRow(["Started", report.totals.started, prev?.started ?? null]);
  summary.addRow(["Still open (now)", report.totals.stillOpen, null]);
  summary.addRow(["Overdue (now)", report.totals.overdue, null]);

  addTable(
    wb.addWorksheet("Per project"),
    [
      { header: "Project", key: "project", width: 32 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "Started", key: "started", width: 12 },
      { header: "Open now", key: "open", width: 12 },
      { header: "Overdue now", key: "overdue", width: 14 },
      { header: "Done", key: "done", width: 10 },
      { header: "Total", key: "total", width: 10 },
      { header: "Progress", key: "progress", width: 12, numFmt: "0%" },
    ],
    report.perProject.map((r) => ({
      project: r.projectName,
      completed: r.completed,
      started: r.started,
      open: r.stillOpen,
      overdue: r.overdue,
      done: r.doneTotal,
      total: r.total,
      progress: r.total > 0 ? r.doneTotal / r.total : 0,
    })),
  );

  addTable(
    wb.addWorksheet("Per member"),
    [
      { header: "Member", key: "member", width: 28 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "Started", key: "started", width: 12 },
      { header: "Open now", key: "open", width: 12 },
      { header: "Overdue now", key: "overdue", width: 14 },
    ],
    report.perMember.map((r) => ({
      member: r.userName || `User ${r.userId}`,
      completed: r.completed,
      started: r.started,
      open: r.openAssigned,
      overdue: r.overdueAssigned,
    })),
  );

  addTaskSheet(wb, "Completed", report.completedTasks, report.completedTruncated);
  addTaskSheet(wb, "Overdue", report.overdueTasks, report.overdueTruncated);

  const activity = wb.addWorksheet("Activity");
  addTable(
    activity,
    [
      { header: "Entity", key: "entity", width: 16 },
      { header: "Action", key: "action", width: 14 },
      { header: "Count", key: "count", width: 10 },
    ],
    report.activitySummary.map((r) => ({
      entity: ENTITY_LABEL[r.entity] ?? r.entity,
      action: ACTION_LABEL[r.action] ?? r.action,
      count: r.count,
    })),
  );
  activity.addRow(["Total", "", report.activityTotal]).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report-${window.granularity}-${window.startDate}.xlsx`;
  a.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
