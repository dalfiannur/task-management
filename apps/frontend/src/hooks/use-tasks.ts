import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskStatus,
  TaskPriority,
} from "@/types/task";

// --- GraphQL fragments & operations ---

const TASK_FIELDS = gql`
  fragment TaskFields on Task {
    id
    taskInfo {
      title
      description
      status
      priority
      startDate
      dueDate
      order
    }
    taskAssignment {
      assigneeIds
      moduleId
    }
    taskLabels {
      labelIds
    }
  }
`;

const LIST_TASKS = gql`
  ${TASK_FIELDS}
  query ListTasks($input: listTasksInput!) {
    listTasks(input: $input) {
      ...TaskFields
    }
  }
`;

const LIST_ALL_TASKS = gql`
  ${TASK_FIELDS}
  query ListAllTasks($input: listAllTasksInput!) {
    listAllTasks(input: $input) {
      ...TaskFields
    }
  }
`;

const GET_TASK = gql`
  ${TASK_FIELDS}
  query GetTask($input: getTaskInput!) {
    getTask(input: $input) {
      ...TaskFields
    }
  }
`;

const CREATE_TASK = gql`
  ${TASK_FIELDS}
  mutation CreateTask($input: createTaskInput!) {
    createTask(input: $input) {
      ...TaskFields
    }
  }
`;

const UPDATE_TASK = gql`
  ${TASK_FIELDS}
  mutation UpdateTask($input: updateTaskInput!) {
    updateTask(input: $input) {
      ...TaskFields
    }
  }
`;

const DELETE_TASK = gql`
  mutation DeleteTask($input: deleteTaskInput!) {
    deleteTask(input: $input)
  }
`;

const REORDER_TASK = gql`
  ${TASK_FIELDS}
  mutation ReorderTask($input: reorderTaskInput!) {
    reorderTask(input: $input) {
      ...TaskFields
    }
  }
`;

// --- Response type from Bunsane ---

interface TaskResponse {
  id: string;
  taskInfo: {
    title: string;
    description: string;
    status: string;
    priority: string;
    startDate: string;
    dueDate: string;
    order: number;
  };
  taskAssignment: {
    assigneeIds: string;
    moduleId: string;
  };
  taskLabels: {
    labelIds: string;
  };
}

function mapTask(t: TaskResponse): Task {
  let labelIds: string[] = [];
  try {
    labelIds = JSON.parse(t.taskLabels.labelIds);
  } catch {
    labelIds = [];
  }

  let assigneeIds: string[] = [];
  try {
    assigneeIds = JSON.parse(t.taskAssignment.assigneeIds);
  } catch {
    assigneeIds = [];
  }

  return {
    id: t.id,
    title: t.taskInfo.title,
    description: t.taskInfo.description || undefined,
    status: t.taskInfo.status as TaskStatus,
    priority: t.taskInfo.priority as TaskPriority,
    startDate: t.taskInfo.startDate || undefined,
    dueDate: t.taskInfo.dueDate || undefined,
    order: t.taskInfo.order,
    assigneeIds,
    moduleId: t.taskAssignment.moduleId,
    labelIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// --- Hooks ---

interface TaskFilters {
  moduleId?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  label?: string;
  search?: string;
  sort?: string;
  page?: number;
}

export function useTasks(filters: TaskFilters = {}) {
  const result = useQuery<{ listTasks: TaskResponse[] }>(LIST_TASKS, {
    variables: {
      input: {
        moduleId: filters.moduleId,
        status: filters.status,
        priority: filters.priority,
        assigneeId: filters.assignee,
        search: filters.search,
        sort: filters.sort,
        page: filters.page,
      },
    },
    skip: !filters.moduleId,
  });
  return normalizeQueryResult(result, (d) => d.listTasks.map(mapTask));
}

export function useTask(taskId: string) {
  const result = useQuery<{ getTask: TaskResponse | null }>(GET_TASK, {
    variables: { input: { id: taskId } },
    skip: !taskId,
  });
  return normalizeQueryResult(result, (d) =>
    d.getTask ? mapTask(d.getTask) : undefined,
  );
}

export function useAllTasks(filters: { projectId?: string } = {}) {
  const result = useQuery<{ listAllTasks: TaskResponse[] }>(LIST_ALL_TASKS, {
    variables: { input: { projectId: filters.projectId } },
  });
  return normalizeQueryResult(result, (d) => d.listAllTasks.map(mapTask));
}

export const useCreateTask = createMutationHook<
  CreateTaskInput,
  TaskResponse,
  Task
>({
  mutation: CREATE_TASK,
  responseKey: "createTask",
  mapVariables: (input) => ({
    input: {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
      assigneeIds: input.assigneeIds,
      moduleId: input.moduleId,
      labelIds: input.labelIds,
    },
  }),
  mapResponse: mapTask,
});

export const useUpdateTask = createMutationHook<
  { id: string; input: UpdateTaskInput },
  TaskResponse,
  Task
>({
  mutation: UPDATE_TASK,
  responseKey: "updateTask",
  mapVariables: (vars) => ({
    input: {
      id: vars.id,
      title: vars.input.title,
      description: vars.input.description,
      status: vars.input.status,
      priority: vars.input.priority,
      startDate: vars.input.startDate,
      dueDate: vars.input.dueDate,
      assigneeIds: vars.input.assigneeIds,
      labelIds: vars.input.labelIds,
    },
  }),
  mapResponse: mapTask,
});

export const useDeleteTask = createVoidMutationHook<string>({
  mutation: DELETE_TASK,
  mapVariables: (id) => ({ input: { id } }),
});

export const useReorderTask = createMutationHook<
  { id: string; newOrder: number; newStatus?: TaskStatus },
  TaskResponse,
  Task
>({
  mutation: REORDER_TASK,
  responseKey: "reorderTask",
  mapVariables: (vars) => ({
    input: { id: vars.id, newOrder: vars.newOrder, newStatus: vars.newStatus },
  }),
  mapResponse: mapTask,
});
