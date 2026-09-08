// Period report read hook (connect-query). Cross-project aggregation, scoped to
// the caller's member projects (admin = all).

import { useQuery } from "@connectrpc/connect-query";
import { ReportService } from "@/lib/gen/reports_pb";
import type { PeriodReport, PeriodWindow } from "../types";
import { mapReport } from "./mappers";

export function usePeriodReport(window: PeriodWindow) {
  const result = useQuery(ReportService.method.getPeriodReport, {
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
  });
  const report: PeriodReport | null = result.data ? mapReport(result.data) : null;
  return { ...result, report };
}
