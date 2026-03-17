import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { TaskInfo } from "../components/TaskInfo";
import { TaskAssignment } from "../components/TaskAssignment";
import { TaskLabels } from "../components/TaskLabels";
import { ModuleProjectRefComponent } from "../components/ModuleComponents";
import { ProjectCoreRefComponent } from "../components/ProjectComponents";

import { resolveLocalProjectId } from "~/lib/resolve-project-id";

import { requirePermission, type AuthContext, TaskResources, Action } from "~/utils/auth";

interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  startDate: string;
  updatedAt: string;
  createdAt: string;
  completedAt: string;
  order: number;
  assigneeIds: string;
  moduleId: string;
  labelIds: string;
}

function serializeTask(entity: any, info: TaskInfo, assignment: TaskAssignment, labels: TaskLabels | null): TaskSummary {
  return {
    id: entity.id,
    title: info.title,
    status: info.status,
    priority: info.priority,
    dueDate: info.dueDate ?? "",
    startDate: info.startDate ?? "",
    updatedAt: info.updatedAt ?? "",
    createdAt: info.createdAt ?? "",
    completedAt: info.completedAt ?? "",
    order: info.order ?? 0,
    assigneeIds: assignment.assigneeIds ?? "[]",
    moduleId: assignment.moduleId ?? "",
    labelIds: labels?.labelIds ?? "[]",
  };
}

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

    const emptyResult = {
      totalTasks: 0,
      inProgressTasks: 0,
      doneTasks: 0,
      deadlineTasks: [],
      myTasks: [],
      recentTasks: [],
      projectProgress: [],
      moduleProjectMap: {},
    };

    if (input.coreProjectIds.length === 0) {
      return emptyResult;
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
      return emptyResult;
    }

    // Build local → core project ID mapping
    const localToCoreMap: Record<string, string> = {};
    for (const p of projects) {
      const coreRef = p.getInMemory(ProjectCoreRefComponent);
      if (coreRef?.value) localToCoreMap[p.id] = coreRef.value;
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
      return emptyResult;
    }

    // Build moduleId → coreProjectId mapping (for frontend to map tasks to projects)
    const moduleProjectMap: Record<string, string> = {};
    for (const m of modules) {
      const ref = m.getInMemory(ModuleProjectRefComponent);
      if (ref?.projectId) {
        moduleProjectMap[m.id] = localToCoreMap[ref.projectId] ?? "";
      }
    }

    // --- Targeted queries instead of loading ALL tasks ---

    // Query 1: My active tasks (assigned to user, not done/cancelled) — limit 21 for display
    const myTaskEntities = await new Query()
      .with(TaskInfo)
      .with(TaskAssignment, {
        filters: [
          Query.filter("moduleId", Query.filterOp.IN, moduleIds),
          Query.typedFilter(TaskAssignment, "assigneeIds", "LIKE", `%"${userId}"%`),
        ],
      })
      .with(TaskLabels)
      .sortBy(TaskInfo, "order", "ASC")
      .take(21)
      .populate()
      .exec();

    const myTaskSummaries: TaskSummary[] = [];
    let totalTasks = 0;
    let inProgressTasks = 0;
    let doneTasks = 0;

    for (const entity of myTaskEntities) {
      const info = entity.getInMemory(TaskInfo);
      const assignment = entity.getInMemory(TaskAssignment);
      if (!info || !assignment) continue;
      const labels = entity.getInMemory(TaskLabels);

      totalTasks++;
      if (info.status === "in_progress") inProgressTasks++;
      else if (info.status === "done") doneTasks++;

      if (info.status !== "done" && info.status !== "cancelled") {
        myTaskSummaries.push(serializeTask(entity, info, assignment, labels ?? null));
      }
    }

    // Query 2: Deadline tasks (due today or overdue, not done/cancelled)
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayEndISO = todayEnd.toISOString();

    const deadlineEntities = await new Query()
      .with(TaskInfo, {
        filters: [
          Query.typedFilter(TaskInfo, "dueDate", "<=", todayEndISO),
        ],
      })
      .with(TaskAssignment, {
        filters: [
          Query.filter("moduleId", Query.filterOp.IN, moduleIds),
        ],
      })
      .with(TaskLabels)
      .sortBy(TaskInfo, "dueDate", "ASC")
      .take(21)
      .populate()
      .exec();

    const deadlineTaskSummaries: TaskSummary[] = [];
    for (const entity of deadlineEntities) {
      const info = entity.getInMemory(TaskInfo);
      const assignment = entity.getInMemory(TaskAssignment);
      if (!info || !assignment) continue;
      if (!info.dueDate || info.status === "done" || info.status === "cancelled") continue;
      const labels = entity.getInMemory(TaskLabels);
      deadlineTaskSummaries.push(serializeTask(entity, info, assignment, labels ?? null));
    }

    // Query 3: Recent tasks (sorted by updatedAt DESC, limit 10)
    const recentEntities = await new Query()
      .with(TaskInfo)
      .with(TaskAssignment, {
        filters: [
          Query.filter("moduleId", Query.filterOp.IN, moduleIds),
        ],
      })
      .with(TaskLabels)
      .sortBy(TaskInfo, "updatedAt", "DESC")
      .take(10)
      .populate()
      .exec();

    const recentTasks: TaskSummary[] = [];
    for (const entity of recentEntities) {
      const info = entity.getInMemory(TaskInfo);
      const assignment = entity.getInMemory(TaskAssignment);
      if (!info || !assignment) continue;
      const labels = entity.getInMemory(TaskLabels);
      recentTasks.push(serializeTask(entity, info, assignment, labels ?? null));
    }

    // Query 4: Per-project progress (all tasks, with safety limit)
    const allTasksForProgress = await new Query()
      .with(TaskInfo)
      .with(TaskAssignment, {
        filters: [
          Query.filter("moduleId", Query.filterOp.IN, moduleIds),
        ],
      })
      .take(10000)
      .populate()
      .exec();

    const projectStats: Record<string, { total: number; done: number; inProgress: number }> = {};
    for (const entity of allTasksForProgress) {
      const info = entity.getInMemory(TaskInfo);
      const assignment = entity.getInMemory(TaskAssignment);
      if (!info || !assignment) continue;

      const coreProjectId = moduleProjectMap[assignment.moduleId];
      if (coreProjectId) {
        if (!projectStats[coreProjectId]) {
          projectStats[coreProjectId] = { total: 0, done: 0, inProgress: 0 };
        }
        projectStats[coreProjectId].total++;
        if (info.status === "done") projectStats[coreProjectId].done++;
        else if (info.status === "in_progress") projectStats[coreProjectId].inProgress++;
      }
    }

    const projectProgress = Object.entries(projectStats).map(([coreProjectId, stats]) => ({
      coreProjectId,
      ...stats,
    }));

    return {
      totalTasks,
      inProgressTasks,
      doneTasks,
      deadlineTasks: deadlineTaskSummaries.slice(0, 20),
      myTasks: myTaskSummaries.slice(0, 20),
      recentTasks,
      projectProgress,
      moduleProjectMap,
    };
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      projectId: t.string().required(),
    },
    output: "JSON",
  })
  async getProjectTaskStats(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);

    const localProjectId = await resolveLocalProjectId(input.projectId);

    // Find modules in this project
    const modules = await new Query()
      .with(ModuleProjectRefComponent, {
        filters: [
          Query.filter("projectId", Query.filterOp.EQ, localProjectId),
        ],
      })
      .populate()
      .exec();

    const moduleIds = modules.map((m) => m.id);
    if (moduleIds.length === 0) {
      return { totalTasks: 0, doneTasks: 0, inProgressTasks: 0 };
    }

    // Find tasks in those modules (with safety limit)
    const tasks = await new Query()
      .with(TaskInfo)
      .with(TaskAssignment, {
        filters: [
          Query.filter("moduleId", Query.filterOp.IN, moduleIds),
        ],
      })
      .take(10000)
      .populate()
      .exec();

    let totalTasks = 0;
    let doneTasks = 0;
    let inProgressTasks = 0;

    for (const entity of tasks) {
      const info = entity.getInMemory(TaskInfo);
      if (!info) continue;
      totalTasks++;
      if (info.status === "done") doneTasks++;
      else if (info.status === "in_progress") inProgressTasks++;
    }

    return { totalTasks, doneTasks, inProgressTasks };
  }
}
