// Dashboard + my-tasks feature barrel.

export type { DashboardStats, ProjectProgress, MyTaskItem, MyTasksView as MyTasksViewKey } from "./types";
export { mapStats, mapMyTasks } from "./api/mappers";
export {
  useDashboardStats,
  useUpcomingDeadlines,
  useMyTasks,
} from "./api/hooks";
export { StatCards } from "./components/stat-cards";
export { UpcomingDeadlines } from "./components/upcoming-deadlines";
export { MyTasksView } from "./components/my-tasks-view";
export { MyTaskRow } from "./components/my-task-row";
