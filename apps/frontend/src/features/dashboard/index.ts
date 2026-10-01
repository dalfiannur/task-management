// Dashboard + my-tasks feature barrel.

export type { DashboardStats, ProjectProgress, MyTaskItem, MyTasksView as MyTasksViewKey } from "./types";
export { mapStats, mapMyTasks } from "./api/mappers";
export { dueGroup, dueLabel, type DueGroup } from "./due";
export {
  useDashboardStats,
  useUpcomingDeadlines,
  useMyTasks,
  useAssignedOpenCount,
} from "./api/hooks";
export { KpiStrip } from "./components/kpi-strip";
export { NeedsAttention } from "./components/needs-attention";
export { ProjectProgressList } from "./components/project-progress-list";
export { MyTasksView } from "./components/my-tasks-view";
export { MyTaskRow } from "./components/my-task-row";
