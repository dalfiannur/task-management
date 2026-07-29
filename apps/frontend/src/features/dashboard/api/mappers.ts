import type {
  DashboardStats as PbStats,
  MyTask as PbMyTask,
} from "@/lib/gen/dashboard_pb";
import { mapTask } from "@/features/tasks";
import type { DashboardStats, MyTaskItem } from "../types";

export function mapStats(s: PbStats): DashboardStats {
  return {
    totalTasks: s.totalTasks,
    inProgressTasks: s.inProgressTasks,
    doneTasks: s.doneTasks,
    overdueTasks: s.overdueTasks,
    perProject: s.perProject.map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      done: p.done,
      total: p.total,
    })),
  };
}

/** Map a MyTask; skips items whose embedded task is absent. */
export function mapMyTasks(items: PbMyTask[]): MyTaskItem[] {
  const out: MyTaskItem[] = [];
  for (const it of items) {
    if (!it.task) continue;
    out.push({
      task: mapTask(it.task),
      projectId: it.projectId,
      projectName: it.projectName,
      moduleName: it.moduleName,
    });
  }
  return out;
}
