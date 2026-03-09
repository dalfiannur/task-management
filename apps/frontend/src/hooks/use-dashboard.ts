import { useQuery, gql } from "@/lib/graphql-client";
import { normalizeQueryResult } from "@/lib/hook-factories";
import type { Task, TaskStatus, TaskPriority } from "@/types/task";

const GET_DASHBOARD_STATS = gql`
  query GetDashboardStats($input: getDashboardStatsInput!) {
    getDashboardStats(input: $input)
  }
`;

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

export interface ProjectProgressData {
  coreProjectId: string;
  total: number;
  done: number;
  inProgress: number;
}

interface DashboardStatsRaw {
  totalTasks: number;
  inProgressTasks: number;
  doneTasks: number;
  deadlineTasks: TaskSummary[];
  myTasks: TaskSummary[];
  recentTasks: TaskSummary[];
  projectProgress: ProjectProgressData[];
  moduleProjectMap: Record<string, string>;
}

export interface DashboardStats {
  totalTasks: number;
  inProgressTasks: number;
  doneTasks: number;
  deadlineTasks: Task[];
  myTasks: Task[];
  recentTasks: Task[];
  projectProgress: ProjectProgressData[];
  moduleProjectMap: Record<string, string>;
}

function mapTaskSummary(t: TaskSummary): Task {
  let labelIds: string[] = [];
  try { labelIds = JSON.parse(t.labelIds); } catch { labelIds = []; }

  let assigneeIds: string[] = [];
  try { assigneeIds = JSON.parse(t.assigneeIds); } catch { assigneeIds = []; }

  return {
    id: t.id,
    title: t.title,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    dueDate: t.dueDate || undefined,
    startDate: t.startDate || undefined,
    updatedAt: t.updatedAt || new Date().toISOString(),
    createdAt: t.createdAt || new Date().toISOString(),
    completedAt: t.completedAt || undefined,
    order: t.order,
    assigneeIds,
    moduleId: t.moduleId,
    labelIds,
  };
}

const GET_PROJECT_TASK_STATS = gql`
  query GetProjectTaskStats($input: getProjectTaskStatsInput!) {
    getProjectTaskStats(input: $input)
  }
`;

interface ProjectTaskStats {
  totalTasks: number;
  doneTasks: number;
  inProgressTasks: number;
}

export function useProjectTaskStats(projectId?: string) {
  const result = useQuery<{ getProjectTaskStats: ProjectTaskStats }>(
    GET_PROJECT_TASK_STATS,
    {
      variables: { input: { projectId } },
      skip: !projectId,
      fetchPolicy: "cache-and-network",
    },
  );
  return normalizeQueryResult(result, (d) => d.getProjectTaskStats);
}

export function useDashboardStats(coreProjectIds: string[]) {
  const result = useQuery<{ getDashboardStats: DashboardStatsRaw }>(
    GET_DASHBOARD_STATS,
    {
      variables: { input: { coreProjectIds } },
      skip: coreProjectIds.length === 0,
      fetchPolicy: "cache-and-network",
    },
  );
  return normalizeQueryResult(result, (d): DashboardStats => {
    const raw = d.getDashboardStats;
    return {
      totalTasks: raw.totalTasks,
      inProgressTasks: raw.inProgressTasks,
      doneTasks: raw.doneTasks,
      deadlineTasks: raw.deadlineTasks.map(mapTaskSummary),
      myTasks: raw.myTasks.map(mapTaskSummary),
      recentTasks: raw.recentTasks.map(mapTaskSummary),
      projectProgress: raw.projectProgress,
      moduleProjectMap: raw.moduleProjectMap,
    };
  });
}
