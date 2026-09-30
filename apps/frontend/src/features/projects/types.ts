// Flat FE types for the projects domain (mapped from gen/projects_pb).

export type ProjectStatus = "active" | "completed" | "archived" | "unspecified";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  ownerId: string;
  startDate?: string;
  endDate?: string;
  /** Task progress — only the list endpoint carries it. */
  tasks?: ProjectTasks;
}

/** Task progress under the dashboard's rules (cancelled counts nowhere). */
export interface ProjectTasks {
  done: number;
  total: number;
  overdue: number;
  /** Earliest due date >= today among open tasks. */
  nextDueDate?: string;
}

export interface ProjectList {
  projects: Project[];
  total: number;
}

/** The three user-facing statuses, in lifecycle order. */
export const PROJECT_STATUSES: ProjectStatus[] = ["active", "completed", "archived"];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
  unspecified: "Unknown",
};
