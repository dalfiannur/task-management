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
      createdAt
      updatedAt
      completedAt
      createdBy
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

const LIST_MY_TASKS = gql`
  query ListMyTasks($input: listMyTasksInput!) {
    listMyTasks(input: $input)
  }
`;

const LIST_TASKS_BY_ME = gql`
  query ListTasksByMe($input: listTasksByMeInput!) {
    listTasksByMe(input: $input)
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
    createdAt: string;
    updatedAt: string;
    completedAt: string;
    createdBy: string;
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
    createdAt: t.taskInfo.createdAt || new Date().toISOString(),
    updatedAt: t.taskInfo.updatedAt || new Date().toISOString(),
    completedAt: t.taskInfo.completedAt || undefined,
    createdBy: t.taskInfo.createdBy || undefined,
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
    fetchPolicy: "cache-and-network",
  });
  return normalizeQueryResult(result, (d) => d.listTasks.map(mapTask));
}

export function useTask(taskId: string) {
  const result = useQuery<{ getTask: TaskResponse | null }>(GET_TASK, {
    variables: { input: { id: taskId } },
    skip: !taskId,
    fetchPolicy: "cache-and-network",
  });
  return normalizeQueryResult(result, (d) =>
    d.getTask ? mapTask(d.getTask) : undefined,
  );
}

export function useAllTasks(
  filters: { projectId?: string; assigneeId?: string } = {},
  options?: { skip?: boolean },
) {
  const result = useQuery<{ listAllTasks: TaskResponse[] }>(LIST_ALL_TASKS, {
    variables: { input: { projectId: filters.projectId, assigneeId: filters.assigneeId } },
    skip: options?.skip,
    fetchPolicy: "cache-and-network",
  });
  return normalizeQueryResult(result, (d) => d.listAllTasks.map(mapTask));
}

interface MyTasksResponse {
  tasks: TaskResponse[];
  moduleMap: Record<string, { name: string; projectId: string }>;
  projectCoreRefMap: Record<string, string>;
}

export function useMyTasks(
  filters: { status?: string; priority?: string } = {},
  options?: { skip?: boolean },
) {
  const result = useQuery<{ listMyTasks: MyTasksResponse }>(LIST_MY_TASKS, {
    variables: { input: { status: filters.status, priority: filters.priority } },
    skip: options?.skip,
    fetchPolicy: "cache-and-network",
  });
  return normalizeQueryResult(result, (d) => ({
    tasks: d.listMyTasks.tasks.map(mapTask),
    moduleMap: d.listMyTasks.moduleMap,
    projectCoreRefMap: d.listMyTasks.projectCoreRefMap,
  }));
}

export function useTasksByMe(
  filters: { status?: string; priority?: string } = {},
  options?: { skip?: boolean },
) {
  const result = useQuery<{ listTasksByMe: MyTasksResponse }>(LIST_TASKS_BY_ME, {
    variables: { input: { status: filters.status, priority: filters.priority } },
    skip: options?.skip,
    fetchPolicy: "cache-and-network",
  });
  return normalizeQueryResult(result, (d) => ({
    tasks: d.listTasksByMe.tasks.map(mapTask),
    moduleMap: d.listTasksByMe.moduleMap,
    projectCoreRefMap: d.listTasksByMe.projectCoreRefMap,
  }));
}

/** Filter tasks due today or overdue, sorted soonest first. Excludes done/cancelled. */
export function getTodayDeadlines(tasks: Task[]): Task[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  return tasks
    .filter((t) => {
      if (!t.dueDate || t.status === "done" || t.status === "cancelled") return false;
      const due = new Date(t.dueDate);
      // Include overdue (before today) and due today
      return due < todayEnd;
    })
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
}

/** Filter tasks that are past their due date and not done/cancelled. */
export function getOverdueTasks(tasks: Task[]): Task[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== "done" && t.status !== "cancelled",
  );
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
  refetchQueries: [LIST_TASKS],
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
  refetchQueries: [LIST_TASKS],
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
  refetchQueries: [LIST_TASKS],
});
