// Modules + Tasks RPC hooks (connect-query over ModuleService/TaskService).
// Reads map proto→flat; writes invalidate the relevant service key.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { ModuleService, TaskService } from "@/lib/gen/work_pb";
import { queryClient } from "@/lib/query";
import type { Module, Task } from "../types";
import { mapModule, mapTask } from "./mappers";

function invalidate(service: typeof ModuleService | typeof TaskService) {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({ schema: service, cardinality: "finite" }),
  });
}
const invalidateModules = () => invalidate(ModuleService);
const invalidateTasks = () => invalidate(TaskService);
// Module structure changes (delete cascade) also affect task lists.
const invalidateBoth = () =>
  Promise.all([invalidateModules(), invalidateTasks()]);

/* ------------------------------ Modules ------------------------------ */

export function useModules(projectId: string) {
  const result = useQuery(
    ModuleService.method.listModules,
    { projectId },
    { enabled: !!projectId },
  );
  const modules: Module[] = (result.data?.modules ?? [])
    .map(mapModule)
    .sort((a, b) => a.order - b.order);
  return { ...result, modules };
}

export function useCreateModule() {
  return useMutation(ModuleService.method.createModule, {
    onSuccess: invalidateModules,
  });
}
export function useUpdateModule() {
  return useMutation(ModuleService.method.updateModule, {
    onSuccess: invalidateModules,
  });
}
export function useDeleteModule() {
  return useMutation(ModuleService.method.deleteModule, {
    onSuccess: invalidateBoth,
  });
}
export function useReorderModules() {
  return useMutation(ModuleService.method.reorderModules, {
    onSuccess: invalidateModules,
  });
}

/* ------------------------------- Tasks ------------------------------- */

export function useTasks(projectId: string) {
  const result = useQuery(
    TaskService.method.listTasks,
    { projectId },
    { enabled: !!projectId },
  );
  const tasks: Task[] = (result.data?.tasks ?? []).map(mapTask);
  return { ...result, tasks };
}

export function useCreateTask() {
  return useMutation(TaskService.method.createTask, {
    onSuccess: invalidateTasks,
  });
}
export function useUpdateTask() {
  return useMutation(TaskService.method.updateTask, {
    onSuccess: invalidateTasks,
  });
}
export function useDeleteTask() {
  return useMutation(TaskService.method.deleteTask, {
    onSuccess: invalidateTasks,
  });
}
export function useMoveTask() {
  return useMutation(TaskService.method.moveTask, {
    onSuccess: invalidateTasks,
  });
}
