// Flat FE types for the dashboard/my-tasks domain, mapped from gen/dashboard_pb.

import type { Task } from "@/features/tasks";

export interface ProjectProgress {
  projectId: string;
  projectName: string;
  done: number;
  total: number;
}

export interface DashboardStats {
  totalTasks: number;
  inProgressTasks: number;
  doneTasks: number;
  overdueTasks: number;
  perProject: ProjectProgress[];
}

/** A task with its project/module context (my-tasks + upcoming deadlines). */
export interface MyTaskItem {
  task: Task;
  projectId: string;
  projectName: string;
  moduleName: string;
}

export type MyTasksView = "assigned" | "created" | "involving";
