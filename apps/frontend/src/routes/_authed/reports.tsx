import { createFileRoute } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ActivitySummary,
  MemberReportTable,
  PeriodPicker,
  ProjectReportTable,
  ReportTaskList,
  ReportTotals,
  periodAtom,
  periodWindow,
  usePeriodReport,
} from "@/features/reports";

export const Route = createFileRoute("/_authed/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [period, setPeriod] = useAtom(periodAtom);
  // `new Date()` is not a stable dependency, so pin the window per selection —
  // otherwise every render produces new instants and refetches the report.
  const window = useMemo(
    () => periodWindow(period.granularity, period.offset),
    [period.granularity, period.offset],
  );
  const { report, isLoading } = usePeriodReport(window);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Reports</h1>
      </div>

      <PeriodPicker
        window={window}
        onGranularity={(granularity) => setPeriod({ granularity, offset: period.offset })}
        onOffset={(offset) => setPeriod({ granularity: period.granularity, offset })}
      />

      {isLoading || !report ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-xl shadow-2" />
          <Skeleton className="h-48 w-full rounded-xl shadow-2" />
        </div>
      ) : (
        <>
          <ReportTotals totals={report.totals} prev={report.prevTotals} />

          <section>
            <h2 className="text-label mb-3">Per project</h2>
            <ProjectReportTable rows={report.perProject} />
          </section>

          <section>
            <h2 className="text-label mb-3">Per member</h2>
            <MemberReportTable rows={report.perMember} />
          </section>

          <section>
            <h2 className="text-label mb-3">Completed this period</h2>
            <ReportTaskList
              items={report.completedTasks}
              truncated={report.completedTruncated}
              empty="Nothing was completed in this period."
            />
          </section>

          <section>
            <h2 className="text-label mb-3">Overdue now</h2>
            <ReportTaskList
              items={report.overdueTasks}
              truncated={report.overdueTruncated}
              empty="Nothing is overdue."
            />
          </section>

          <section>
            <h2 className="text-label mb-3">Activity</h2>
            <ActivitySummary rows={report.activitySummary} total={report.activityTotal} />
          </section>
        </>
      )}
    </div>
  );
}
