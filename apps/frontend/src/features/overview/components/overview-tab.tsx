import { AlertTriangle, CheckCircle2, Clock, LayoutDashboard, ListTodo } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectActivity } from "@/features/activity";
import { useProject } from "@/features/projects";
import { useProjectOverview } from "../api/hooks";
import { ModuleProgressList } from "./module-progress-list";
import { ProjectInfoCard } from "./project-info-card";

/** Overview: tab pertama dan tujuan default project detail. Read-only —
 *  setiap mutasi tetap tinggal di tabnya masing-masing. */
export function OverviewTab({ projectId }: { projectId: string }) {
  const { overview, isLoading, isError, error } = useProjectOverview(projectId);
  const { project } = useProject(projectId);

  if (isLoading) {
    return (
      /* Skeleton mengikuti bentuk akhirnya — satu baris empat kartu, dua
         kolom, lalu blok activity — supaya tidak ada lompatan layout saat
         data masuk. */
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl shadow-2" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-56 w-full rounded-xl shadow-2" />
          <Skeleton className="h-56 w-full rounded-xl shadow-2" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-32 rounded-xl shadow-2" />
          <Skeleton className="h-48 w-full rounded-xl shadow-2" />
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

  const pct =
    overview.totalTasks > 0
      ? Math.round((overview.doneTasks / overview.totalTasks) * 100)
      : 0;

  return (
    <div className="space-y-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ListTodo} label="Total tasks" value={overview.totalTasks} />
        <StatCard icon={Clock} label="In progress" value={overview.inProgressTasks} />
        <StatCard icon={CheckCircle2} label="Done" value={overview.doneTasks} />
        <StatCard
          icon={AlertTriangle}
          label="Overdue"
          value={overview.overdueTasks}
          alert
        />
      </div>

      {/* Kolom kanan dipatok 20rem: panel About isinya label+nilai pendek, dan
          membiarkannya ikut melar membuat barisnya renggang tak keruan. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-xl bg-surface-raised p-4 shadow-2">
          <h2 className="text-label mb-3">Progress</h2>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-num text-sm font-semibold">{pct}%</span>
          </div>
          <ModuleProgressList modules={overview.perModule} />
        </div>

        {project && <ProjectInfoCard project={project} overview={overview} />}
      </div>

      {/* Tanpa kartu pembungkus di sini: ProjectActivity (lewat ActivityFeed)
          sudah membawa kartu raised-nya sendiri untuk ketiga state-nya (loading,
          kosong, terisi). Menambah satu lagi di sini menghasilkan kartu di
          dalam kartu — bahasa yang sama sekali tidak dipakai di dashboard, yang
          menaruh heading polos di kanvas lalu komponennya langsung di
          bawahnya (lihat routes/_authed/dashboard.tsx). */}
      <section>
        <h2 className="text-label mb-3">Recent activity</h2>
        <ProjectActivity projectId={projectId} pageSize={10} />
      </section>
    </div>
  );
}
