// Modules + Tasks RPC hooks (connect-query over ModuleService/TaskService).
// Reads map proto→flat. Create/Update patch the task caches from the response
// (no list refetch); the writes that reshape a list still invalidate.

import { useMemo } from "react";
import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  useMutation,
  useQuery,
  useTransport,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import {
  ListTasksResponseSchema,
  ModuleService,
  TaskPriority as PbPriority,
  TaskStatus as PbStatus,
  TaskSchema,
  TaskService,
  type CreateTaskRequestSchema,
  type UpdateTaskRequestSchema,
  type Task as PbTask,
} from "@/lib/gen/work_pb";
import { currentUserAtom } from "@/features/auth";
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
  // Memoised on the cached response, not recomputed per render: `mapTask`
  // mints new objects, and a consumer that keys an effect on a task it picked
  // out of this list would otherwise see a "new" task on every unrelated
  // re-render of its parent (see the reset effect in task-dialog).
  const tasks: Task[] = useMemo(
    () => (result.data?.tasks ?? []).map(mapTask),
    [result.data],
  );
  return { ...result, tasks };
}

/** Single task by id — the fallback for a URL-addressed task dialog when the
 *  task isn't already in a loaded list (e.g. a cold deep link). */
export function useTask(id: string | undefined) {
  const result = useQuery(
    TaskService.method.getTask,
    { id: id ?? "" },
    { enabled: !!id, retry: false },
  );
  const task: Task | undefined = useMemo(
    () => (result.data ? mapTask(result.data) : undefined),
    [result.data],
  );
  return { ...result, task };
}

/* ------------------------ Optimistic writes ------------------------- */

/**
 * The exact cache keys the task reads use, so a write can patch them instead
 * of refetching. CreateTask/UpdateTask return the saved row in full and touch
 * no other task on the server, so the response *is* the new cache value —
 * writing it in leaves nothing for a ListTasks round-trip to correct.
 */
function useTaskKeys(projectId: string) {
  const transport = useTransport();
  const listKey = createConnectQueryKey({
    schema: TaskService.method.listTasks,
    transport,
    input: { projectId },
    cardinality: "finite",
  });
  // The deep-link fallback in `useTask` caches per id; keep it in step so a
  // dialog opened cold doesn't keep showing the pre-edit task.
  const taskKey = (id: string) =>
    createConnectQueryKey({
      schema: TaskService.method.getTask,
      transport,
      input: { id },
      cardinality: "finite",
    });
  return { listKey, taskKey };
}

/* ------------------------- Optimistic create ------------------------- */

// A placeholder row carries a client-minted id, so nothing that needs a real
// one (opening it, dragging it, deleting it) may act on it. `isOptimisticTaskId`
// is what the UI gates those affordances on until the server's row arrives.
const OPTIMISTIC_ID_PREFIX = "optimistic:";

export function isOptimisticTaskId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/**
 * The row shown while CreateTask is in flight. It mirrors the server's own
 * defaulting — status/priority fallbacks, next order in the module, a subtask
 * living in its parent's module — so the row doesn't visibly jump or re-sort
 * when the real task replaces it.
 */
function optimisticTask(
  input: MessageInitShape<typeof CreateTaskRequestSchema>,
  existing: readonly PbTask[],
  createdBy: string,
): PbTask {
  const parentId = input.parentId?.trim() ? input.parentId : undefined;
  // The backend ignores the request's module_id for a subtask and files it
  // under the parent's module; mirror that rather than trusting the input.
  const moduleId =
    (parentId && existing.find((t) => t.id === parentId)?.moduleId) ||
    input.moduleId ||
    "";
  // next_order_in_module: max order across the whole module (subtasks
  // included), or 0 when it's empty.
  const order =
    existing
      .filter((t) => t.moduleId === moduleId)
      .reduce((max, t) => Math.max(max, t.order), -1) + 1;
  // UNSPECIFIED is 0, so falsy covers both "omitted" and "unspecified" —
  // the same two cases the backend defaults.
  const status = input.status || PbStatus.TODO;
  const priority = input.priority || PbPriority.NONE;
  const now = new Date().toISOString();
  return create(TaskSchema, {
    id: `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`,
    moduleId,
    title: input.title?.trim() ?? "",
    description: input.description ?? "",
    status,
    priority,
    startDate: input.startDate || undefined,
    dueDate: input.dueDate || undefined,
    order,
    assigneeIds: [...(input.assigneeIds ?? [])],
    labelIds: [...(input.labelIds ?? [])],
    createdAt: now,
    updatedAt: now,
    completedAt: status === PbStatus.DONE ? now : undefined,
    createdBy,
    parentId,
    // Dependencies can only be attached to a saved task.
    blockedByIds: [],
  });
}

/**
 * CreateTask with an optimistic insert into this project's ListTasks cache:
 * the row appears the moment the form is submitted, is swapped for the
 * server's row on success, and is pulled back out on failure.
 *
 * The insert/swap/remove are all targeted at the one placeholder rather than
 * snapshot-and-restore of the whole list, so two quick-adds in flight at once
 * can't undo each other.
 */
export function useCreateTask(projectId: string) {
  const me = useAtomValue(currentUserAtom);
  const { listKey, taskKey } = useTaskKeys(projectId);

  return useMutation(TaskService.method.createTask, {
    onMutate: async (input) => {
      // An in-flight ListTasks refetch would land without the new row and
      // wipe the insert — cancel it; a query with no cached list refetches on
      // mount and picks the row up from the server instead.
      await queryClient.cancelQueries({ queryKey: listKey });
      const cached = queryClient.getQueryData(listKey);
      // Nothing to insert into: seeding a one-row "list" here would be a
      // wrong answer for the next reader of this key.
      if (!cached) return { tempId: undefined };
      const optimistic = optimisticTask(input, cached.tasks, me?.id ?? "");
      queryClient.setQueryData(listKey, (old) =>
        create(ListTasksResponseSchema, {
          tasks: [...(old?.tasks ?? []), optimistic],
        }),
      );
      return { tempId: optimistic.id };
    },
    onSuccess: (task, _input, ctx) => {
      // Swap in the server's row (real id, sanitized description, real
      // order) before anything can act on the placeholder.
      queryClient.setQueryData(listKey, (old) => {
        if (!old) return old;
        const swapped = !!ctx.tempId && old.tasks.some((t) => t.id === ctx.tempId);
        return create(ListTasksResponseSchema, {
          tasks: swapped
            ? old.tasks.map((t) => (t.id === ctx.tempId ? task : t))
            : [...old.tasks, task],
        });
      });
      queryClient.setQueryData(taskKey(task.id), task);
    },
    onError: (err, _input, ctx) => {
      // The failure toast belongs to the hook, not the caller: the create
      // form (the task dialog) closes as soon as the row appears, and a
      // callback passed to `mutate` from an unmounted component never runs.
      toast.error(err.message || "Failed to create task");
      const tempId = ctx?.tempId;
      if (!tempId) return;
      queryClient.setQueryData(listKey, (old) =>
        old
          ? create(ListTasksResponseSchema, {
              tasks: old.tasks.filter((t) => t.id !== tempId),
            })
          : old,
      );
    },
  });
}

/* ------------------------- Optimistic update ------------------------- */

/**
 * Apply an UpdateTaskRequest to a cached task the way the server does:
 * an absent field leaves its value alone, an empty date string clears it, a
 * present `StringList` wrapper replaces the whole list (an empty one included),
 * and `completedAt` follows the transition into and out of Done.
 */
function applyUpdate(
  task: PbTask,
  input: MessageInitShape<typeof UpdateTaskRequestSchema>,
): PbTask {
  const next = clone(TaskSchema, task);
  if (input.title !== undefined) next.title = input.title.trim();
  if (input.description !== undefined) next.description = input.description;
  if (input.status !== undefined) next.status = input.status;
  if (input.priority !== undefined) next.priority = input.priority;
  // Dates: "" clears, a value sets, absent keeps.
  if (input.startDate !== undefined) next.startDate = input.startDate || undefined;
  if (input.dueDate !== undefined) next.dueDate = input.dueDate || undefined;
  if (input.assigneeIds) next.assigneeIds = [...(input.assigneeIds.values ?? [])];
  if (input.labelIds) next.labelIds = [...(input.labelIds.values ?? [])];
  if (input.blockedByIds) next.blockedByIds = [...(input.blockedByIds.values ?? [])];
  // parentIdSet: absent = unchanged, empty = detach, one = that parent.
  if (input.parentIdSet) next.parentId = input.parentIdSet.values?.[0] || undefined;

  const now = new Date().toISOString();
  next.completedAt =
    next.status === PbStatus.DONE
      ? // Already done before this edit? Keep the original completion time.
        task.status === PbStatus.DONE
        ? task.completedAt
        : now
      : undefined;
  next.updatedAt = now;
  return next;
}

/**
 * UpdateTask applied to this project's ListTasks cache before the round-trip,
 * so a checkbox, a drag on the timeline or a saved dialog lands immediately.
 * On failure the one task is restored to the value it held before the edit —
 * the rest of the list is left alone, so a second edit in flight survives.
 */
export function useUpdateTask(projectId: string) {
  const { listKey, taskKey } = useTaskKeys(projectId);

  function patch(id: string, next: (task: PbTask) => PbTask) {
    queryClient.setQueryData(listKey, (old) =>
      old
        ? create(ListTasksResponseSchema, {
            tasks: old.tasks.map((t) => (t.id === id ? next(t) : t)),
          })
        : old,
    );
    // Only when the deep-link fallback actually holds this task — writing a
    // row into an empty GetTask entry would answer a fetch nobody made.
    queryClient.setQueryData(taskKey(id), (old) => (old ? next(old) : old));
  }

  return useMutation(TaskService.method.updateTask, {
    onMutate: async (input) => {
      const id = input.id;
      if (!id) return { before: undefined };
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: taskKey(id) }),
      ]);
      // A task opened by a cold deep link lives only in the GetTask cache;
      // edit it from there so that dialog is optimistic too.
      const before =
        queryClient.getQueryData(listKey)?.tasks.find((t) => t.id === id) ??
        queryClient.getQueryData(taskKey(id));
      if (!before) return { before: undefined };
      patch(id, (t) => applyUpdate(t, input));
      return { before };
    },
    onSuccess: (task) => patch(task.id, () => task),
    onError: (err, _input, ctx) => {
      // Owned by the hook, not the caller: the edit dialog closes on submit,
      // and a callback passed to `mutate` from an unmounted component never
      // runs — the same reason create reports its own failures.
      toast.error(err.message || "Failed to update task");
      const before = ctx?.before;
      if (before) patch(before.id, () => before);
    },
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
