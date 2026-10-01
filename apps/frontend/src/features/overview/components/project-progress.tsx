import { useMemo } from "react";
import { useTasks } from "@/features/tasks";
import type { ProjectOverview } from "../types";
import { ModuleProgressList } from "./module-progress-list";

/** Progress card: the whole project's completion as one stacked bar (done,
 *  in progress, the rest), then the per-module list under a hairline.
 *
 *  The bar has two fills, not one per status: done is the brand colour, in
 *  progress a lighter brand fill, and everything still open is the empty track.
 *  More colours would make the bar a legend exercise (aturan 4). */
export function ProjectProgress({
  projectId,
  overview,
}: {
  projectId: string;
  overview: ProjectOverview;
}) {
  const { tasks } = useTasks(projectId);

  // Same rule as the server's Overdue count: an open task due before today
  // in UTC. Until the task list arrives the map is empty and each module
  // shows its % — no flash of a wrong overdue number.
  const overdueByModule = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const m = new Map<string, number>();
    for (const t of tasks) {
      const due = t.dueDate?.slice(0, 10);
      if (!due || due >= today) continue;
      if (t.status === "done" || t.status === "cancelled") continue;
      m.set(t.moduleId, (m.get(t.moduleId) ?? 0) + 1);
    }
    return m;
  }, [tasks]);

  const { totalTasks: total, doneTasks: done, inProgressTasks: active } = overview;
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const pct = Math.round(share(done));

  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-num text-3xl font-semibold">{pct}%</span>
          <span className="text-num text-sm text-text-muted">
            {done} of {total} done
          </span>
        </div>
        <div
          className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-sunken"
          role="img"
          aria-label={`${done} done, ${active} in progress, ${total - done - active} remaining`}
        >
          <div className="h-full bg-brand" style={{ width: `${share(done)}%` }} />
          <div
            className="h-full bg-brand-soft"
            style={{ width: `${share(active)}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          <Legend swatch="bg-brand" label="Done" value={done} />
          <Legend swatch="bg-brand-soft" label="In progress" value={active} />
          <Legend
            swatch="bg-surface-sunken ring-1 ring-inset ring-border-field"
            label="Remaining"
            value={total - done - active}
          />
        </div>
      </div>

      {overview.perModule.length > 0 && (
        <div className="border-t border-border-subtle">
          <h3 className="text-label px-4 pb-1 pt-3">Modules</h3>
          <ModuleProgressList
            modules={overview.perModule}
            overdueByModule={overdueByModule}
          />
        </div>
      )}
    </div>
  );
}

function Legend({
  swatch,
  label,
  value,
}: {
  swatch: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${swatch}`} />
      {label}
      <span className="text-num text-text">{value}</span>
    </span>
  );
}
