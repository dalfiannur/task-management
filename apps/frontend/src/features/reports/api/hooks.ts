// Period report hooks (connect-query). Cross-project aggregation, scoped to
// the caller's member projects (admin = all).

import { useMutation, useQuery } from "@connectrpc/connect-query";
import { ReportService } from "@/lib/gen/reports_pb";
import type { PeriodReport, PeriodWindow } from "../types";
import { mapReport } from "./mappers";

/** The request for a window. Both the page and the export send exactly this. */
function reportRequest(window: PeriodWindow) {
  return {
    // Local midnight, expressed as an instant. The server truncates these to
    // whole seconds and compares stored timestamps against them.
    periodStart: window.start.toISOString(),
    periodEnd: window.end.toISOString(),
    prevStart: window.prevStart.toISOString(),
    prevEnd: window.prevEnd.toISOString(),
    // The same window as local calendar dates, for `start_date`. Required, not
    // optional: the server cannot derive these from the instants above without
    // being wrong by a day for any viewer off UTC.
    periodStartDate: window.startDate,
    periodEndDate: window.endDate,
    prevStartDate: window.prevStartDate,
    prevEndDate: window.prevEndDate,
  };
}

export function usePeriodReport(window: PeriodWindow) {
  const result = useQuery(ReportService.method.getPeriodReport, reportRequest(window));
  const report: PeriodReport | null = result.data ? mapReport(result.data) : null;
  return { ...result, report };
}

/** The report as an .xlsx built by the server — every row, not the page's 50. */
export function useExportReportXlsx() {
  const mutation = useMutation(ReportService.method.exportPeriodReportXlsx);
  return {
    ...mutation,
    exportXlsx: (window: PeriodWindow, appName: string) =>
      mutation.mutateAsync({
        report: reportRequest(window),
        label: window.label,
        granularity: window.granularity,
        // getTimezoneOffset is minutes *west* of UTC; the server wants east.
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        appName,
      }),
  };
}
