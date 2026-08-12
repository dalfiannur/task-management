// Flat FE types for the project Overview tab, mapped from gen/dashboard_pb.

export interface ModuleProgress {
  moduleId: string;
  moduleName: string;
  done: number;
  total: number;
}

export interface ProjectOverview {
  totalTasks: number;
  inProgressTasks: number;
  doneTasks: number;
  overdueTasks: number;
  /** Module order, matching the Tasks tab. Empty modules included as 0/0. */
  perModule: ModuleProgress[];
  /** Owner first. */
  memberIds: string[];
  moduleCount: number;
  pageCount: number;
  mediaCount: number;
}
