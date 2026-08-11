import type { ProjectOverview as PbOverview } from "@/lib/gen/dashboard_pb";
import type { ProjectOverview } from "../types";

export function mapOverview(o: PbOverview): ProjectOverview {
  return {
    totalTasks: o.totalTasks,
    inProgressTasks: o.inProgressTasks,
    doneTasks: o.doneTasks,
    overdueTasks: o.overdueTasks,
    perModule: o.perModule.map((m) => ({
      moduleId: m.moduleId,
      moduleName: m.moduleName,
      done: m.done,
      total: m.total,
    })),
    memberIds: [...o.memberIds],
    moduleCount: o.moduleCount,
    pageCount: o.pageCount,
    mediaCount: o.mediaCount,
  };
}
