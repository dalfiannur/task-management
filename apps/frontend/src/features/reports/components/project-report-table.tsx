import { Link } from "@tanstack/react-router";
import type { ProjectReportRow } from "../types";

export function ProjectReportTable({ rows }: { rows: ProjectReportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        No projects in scope.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-surface-raised shadow-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="text-label px-4 py-3 text-left">Project</th>
            <th className="text-label px-4 py-3 text-right">Completed</th>
            <th className="text-label px-4 py-3 text-right">Created</th>
            <th className="text-label px-4 py-3 text-right">Open</th>
            <th className="text-label px-4 py-3 text-right">Overdue</th>
            <th className="text-label px-4 py-3 text-right">Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.total > 0 ? Math.round((r.doneTotal / r.total) * 100) : 0;
            return (
              <tr
                key={r.projectId}
                className="border-b border-border-subtle last:border-b-0 print:break-inside-avoid"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/projects/$projectId/all-tasks"
                    params={{ projectId: r.projectId }}
                    className="truncate font-medium hover:underline"
                  >
                    {r.projectName}
                  </Link>
                </td>
                <td className="text-num px-4 py-3 text-right">{r.completed}</td>
                <td className="text-num px-4 py-3 text-right">{r.created}</td>
                <td className="text-num px-4 py-3 text-right">{r.stillOpen}</td>
                <td className="text-num px-4 py-3 text-right">
                  {r.overdue > 0 ? (
                    <span className="text-danger">{r.overdue}</span>
                  ) : (
                    r.overdue
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken">
                      <span
                        className="block h-full rounded-full bg-brand"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-num text-xs text-text-muted">
                      {r.doneTotal}/{r.total}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
