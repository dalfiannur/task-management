import { useQuery, useMutation, gql } from "@/lib/graphql-client";
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
  const { data, loading, error } = useQuery<{ listTasks: TaskResponse[] }>(
    LIST_TASKS,
    {
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
    },
  );

  return {
    data: data?.listTasks.map(mapTask),
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useTask(taskId: string) {
  const { data, loading, error } = useQuery<{
    getTask: TaskResponse | null;
  }>(GET_TASK, {
    variables: { input: { id: taskId } },
    skip: !taskId,
  });

  return {
    data: data?.getTask ? mapTask(data.getTask) : undefined,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useCreateTask() {
  const [exec, { loading }] = useMutation<{ createTask: TaskResponse }>(
    CREATE_TASK,
  );

  return {
    mutate: (
      input: CreateTaskInput,
      opts?: { onSuccess?: (data: Task) => void },
    ) => {
      exec({
        variables: {
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
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(mapTask(res.data.createTask));
      });
    },
    mutateAsync: async (input: CreateTaskInput): Promise<Task> => {
      const res = await exec({
        variables: {
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
        },
      });
      return mapTask(res.data!.createTask);
    },
    isPending: loading,
  };
}

export function useUpdateTask() {
  const [exec, { loading }] = useMutation<{ updateTask: TaskResponse }>(
    UPDATE_TASK,
  );

  return {
    mutate: (
      vars: { id: string; input: UpdateTaskInput },
      opts?: { onSuccess?: (data: Task) => void },
    ) => {
      exec({
        variables: {
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
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(mapTask(res.data.updateTask));
      });
    },
    mutateAsync: async (vars: {
      id: string;
      input: UpdateTaskInput;
    }): Promise<Task> => {
      const res = await exec({
        variables: {
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
        },
      });
      return mapTask(res.data!.updateTask);
    },
    isPending: loading,
  };
}

export function useDeleteTask() {
  const [exec, { loading }] = useMutation<{ deleteTask: boolean }>(
    DELETE_TASK,
  );

  return {
    mutate: (id: string, opts?: { onSuccess?: () => void }) => {
      exec({ variables: { input: { id } } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (id: string): Promise<void> => {
      await exec({ variables: { input: { id } } });
    },
    isPending: loading,
  };
}

export function useReorderTask() {
  const [exec, { loading }] = useMutation<{ reorderTask: TaskResponse }>(
    REORDER_TASK,
  );

  return {
    mutate: (
      vars: { id: string; newOrder: number; newStatus?: TaskStatus },
      opts?: { onSuccess?: (data: Task) => void },
    ) => {
      exec({
        variables: {
          input: {
            id: vars.id,
            newOrder: vars.newOrder,
            newStatus: vars.newStatus,
          },
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(mapTask(res.data.reorderTask));
      });
    },
    mutateAsync: async (vars: {
      id: string;
      newOrder: number;
      newStatus?: TaskStatus;
    }): Promise<Task> => {
      const res = await exec({
        variables: {
          input: {
            id: vars.id,
            newOrder: vars.newOrder,
            newStatus: vars.newStatus,
          },
        },
      });
      return mapTask(res.data!.reorderTask);
    },
    isPending: loading,
  };
}

export function useAllTasks(filters: { projectId?: string } = {}) {
  const { data, loading, error } = useQuery<{
    listAllTasks: TaskResponse[];
  }>(LIST_ALL_TASKS, {
    variables: { input: { projectId: filters.projectId } },
  });

  return {
    data: data?.listAllTasks.map(mapTask),
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}
