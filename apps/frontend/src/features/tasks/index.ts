// Tasks feature barrel (modules + tasks / all-tasks tab).

export type { Module, Task, TaskStatus, TaskPriority } from "./types";
export { TASK_STATUSES, TASK_PRIORITIES } from "./types";
export { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from "./config";
export {
  mapModule,
  mapTask,
  statusToProto,
  statusFromProto,
  priorityToProto,
  priorityFromProto,
} from "./api/mappers";
export {
  useModules,
  useCreateModule,
  useUpdateModule,
  useDeleteModule,
  useReorderModules,
  useTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useMoveTask,
} from "./api/hooks";
export { AllTasksTab } from "./components/all-tasks-tab";
export { StatusBadge, PriorityLabel } from "./components/task-badges";
