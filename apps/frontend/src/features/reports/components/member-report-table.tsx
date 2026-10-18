import { formatMinutes } from "@/lib/duration";
import type { MemberReportRow } from "../types";

export function MemberReportTable({ rows }: { rows: MemberReportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
        No member activity in this period.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-label px-4 py-3 text-left">Member</th>
            <th className="text-label px-4 py-3 text-right">Completed</th>
            <th className="text-label px-4 py-3 text-right">Started</th>
            <th className="text-label px-4 py-3 text-right">Open now</th>
            <th className="text-label px-4 py-3 text-right">Overdue now</th>
            <th className="text-label px-4 py-3 text-right">Time logged</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId}
              className="border-b border-border last:border-b-0 print:break-inside-avoid"
            >
              {/* A member whose user record is gone keeps its id, so their work
                  is still counted rather than silently disappearing. */}
              <td className="px-4 py-3 font-medium">
                {r.userName || `User ${r.userId}`}
              </td>
              <td className="text-num px-4 py-3 text-right">{r.completed}</td>
              <td className="text-num px-4 py-3 text-right">{r.started}</td>
              <td className="text-num px-4 py-3 text-right">{r.openAssigned}</td>
              <td className="text-num px-4 py-3 text-right">
                {r.overdueAssigned > 0 ? (
                  <span className="text-destructive">{r.overdueAssigned}</span>
                ) : (
                  r.overdueAssigned
                )}
              </td>
              <td className="text-num px-4 py-3 text-right">
                {r.loggedMinutes ? formatMinutes(r.loggedMinutes) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
