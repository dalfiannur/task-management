import { Link } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiStrip } from "@/components/shared/kpi-strip";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectActivity } from "@/features/activity";
import { useProject } from "@/features/projects";
import { useProjectOverview } from "../api/hooks";
import { ProjectAttention } from "./project-attention";
import { ProjectProgress } from "./project-progress";
import { ProjectInfoCard } from "./project-info-card";

/** Overview: tab pertama dan tujuan default project detail. Read-only —
 *  setiap mutasi tetap tinggal di tabnya masing-masing.
 *
 *  Tata letaknya meniru dashboard (routes/_authed/dashboard.tsx) dengan
 *  cakupan satu project: strip KPI, lalu kolom utama untuk yang menuntut
 *  tindakan (Needs attention, Progress) dan rail kanan untuk konteks (About,
 *  Recent activity). Heading polos di kanvas, komponen berkartu di bawahnya. */
export function OverviewTab({ projectId }: { projectId: string }) {
  const { overview, isLoading, isError, error } = useProjectOverview(projectId);
  const { project } = useProject(projectId);

  if (isLoading) {
    return (
      /* Skeleton mengikuti bentuk akhirnya supaya tidak ada lompatan layout
         saat data masuk. */
      <div className="space-y-6 p-4 sm:p-6">
        <Skeleton className="h-[88px] w-full rounded-xl shadow-2" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Skeleton className="h-64 w-full rounded-xl shadow-2" />
            <Skeleton className="h-56 w-full rounded-xl shadow-2" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full rounded-xl shadow-2" />
            <Skeleton className="h-64 w-full rounded-xl shadow-2" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !overview) {
    return (
      <div className="p-12 text-center">
        <p className="text-danger">
          {error?.message ?? "Couldn’t load this project’s overview."}
        </p>
      </div>
    );
  }

  // Project betul-betul kosong: belum ada module DAN belum ada task. Statistik
  // nol-semua tidak memberi tahu apa pun, jadi arahkan ke tempat mengisinya.
  if (overview.moduleCount === 0 && overview.totalTasks === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={LayoutDashboard}
          title="Nothing to summarise yet"
          body="Once this project has modules and tasks, their progress shows up here."
          action={{
            label: "Go to Tasks",
            to: "/projects/$projectId/all-tasks",
            params: { projectId },
          }}
        />
      </div>
    );
  }

  const donePct =
    overview.totalTasks > 0
      ? Math.round((overview.doneTasks / overview.totalTasks) * 100)
      : 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <KpiStrip
        cells={[
          { label: "Total tasks", value: overview.totalTasks },
          { label: "In progress", value: overview.inProgressTasks },
          { label: "Done", value: overview.doneTasks, hint: `${donePct}%` },
          {
            label: "Overdue",
            value: overview.overdueTasks,
            alert: overview.overdueTasks > 0,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-label">Needs attention</h2>
              <Link
                to="/projects/$projectId/all-tasks"
                params={{ projectId }}
                className="text-xs text-text-muted hover:text-text"
              >
                All tasks →
              </Link>
            </div>
            <ProjectAttention projectId={projectId} withinDays={7} />
          </section>

          <section>
            <h2 className="text-label mb-3">Progress</h2>
            <ProjectProgress projectId={projectId} overview={overview} />
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          {project && (
            <section>
              <h2 className="text-label mb-3">About</h2>
              <ProjectInfoCard project={project} overview={overview} />
            </section>
          )}
          {/* Tanpa kartu pembungkus: ProjectActivity (lewat ActivityFeed)
              sudah membawa kartu raised-nya sendiri untuk ketiga state-nya. */}
          <section>
            <h2 className="text-label mb-3">Recent activity</h2>
            <ProjectActivity projectId={projectId} pageSize={8} />
          </section>
        </aside>
      </div>
    </div>
  );
}
