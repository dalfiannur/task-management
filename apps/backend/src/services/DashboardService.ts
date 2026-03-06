import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { TaskInfo } from "../components/TaskInfo";
import { TaskAssignment } from "../components/TaskAssignment";
import { ModuleProjectRefComponent } from "../components/ModuleComponents";
import { ProjectCoreRefComponent } from "../components/ProjectComponents";

import { requirePermission, type AuthContext, TaskResources, Action } from "~/utils/auth";

export default class DashboardService extends BaseService {
  @GraphQLOperation({
    type: "Query",
    input: {
      coreProjectIds: t.list(t.string()).required(),
    },
    output: "JSON",
  })
  async getDashboardStats(input: { coreProjectIds: string[] }, context: AuthContext) {
    const user = requirePermission(context, TaskResources.Tasks, Action.Read);
    const userId = user.sub;

    if (input.coreProjectIds.length === 0) {
      return { totalTasks: 0, inProgressTasks: 0, doneTasks: 0 };
    }

    // Resolve Core Portal IDs → local project IDs
    const projects = await new Query()
      .with(ProjectCoreRefComponent, {
        filters: [
          Query.filter("value", Query.filterOp.IN, input.coreProjectIds),
        ],
      })
      .populate()
      .exec();

    const localProjectIds = projects.map((p) => p.id);
    if (localProjectIds.length === 0) {
      return { totalTasks: 0, inProgressTasks: 0, doneTasks: 0 };
    }

    // Find modules belonging to those projects
    const modules = await new Query()
      .with(ModuleProjectRefComponent, {
        filters: [
          Query.filter("projectId", Query.filterOp.IN, localProjectIds),
        ],
      })
      .populate()
      .exec();

    const moduleIds = [...new Set(modules.map((m) => m.id))];
    if (moduleIds.length === 0) {
      return { totalTasks: 0, inProgressTasks: 0, doneTasks: 0 };
    }

    // Find tasks in those modules
    const tasks = await new Query()
      .with(TaskInfo)
      .with(TaskAssignment, {
        filters: [
          Query.filter("moduleId", Query.filterOp.IN, moduleIds),
        ],
      })
      .populate()
      .exec();

    let totalTasks = 0;
    let inProgressTasks = 0;
    let doneTasks = 0;

    for (const entity of tasks) {
      const assignment = entity.getInMemory(TaskAssignment);
      if (!assignment) continue;

      // Only count tasks assigned to the current user
      const assigneeIds = assignment.getAssigneeIdArray();
      if (!assigneeIds.includes(userId)) continue;

      const info = entity.getInMemory(TaskInfo);
      if (!info) continue;

      totalTasks++;
      if (info.status === "in_progress") inProgressTasks++;
      else if (info.status === "done") doneTasks++;
    }

    return { totalTasks, inProgressTasks, doneTasks };
  }
}
