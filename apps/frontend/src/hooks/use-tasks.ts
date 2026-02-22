import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: async (): Promise<Task[]> => {
      if (!filters.moduleId) return [];
      const data = await graphqlClient.request<{
        listTasks: TaskResponse[];
      }>(LIST_TASKS, {
        input: {
          moduleId: filters.moduleId,
          status: filters.status,
          priority: filters.priority,
          assigneeId: filters.assignee,
          search: filters.search,
          sort: filters.sort,
          page: filters.page,
        },
      });
      return data.listTasks.map(mapTask);
    },
    enabled: !!filters.moduleId,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ["tasks", taskId],
    queryFn: async (): Promise<Task | undefined> => {
      const data = await graphqlClient.request<{
        getTask: TaskResponse | null;
      }>(GET_TASK, { input: { id: taskId } });
      return data.getTask ? mapTask(data.getTask) : undefined;
    },
    enabled: !!taskId,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskInput): Promise<Task> => {
      const data = await graphqlClient.request<{
        createTask: TaskResponse;
      }>(CREATE_TASK, {
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
      });
      return mapTask(data.createTask);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateTaskInput;
    }): Promise<Task> => {
      const data = await graphqlClient.request<{
        updateTask: TaskResponse;
      }>(UPDATE_TASK, {
        input: {
          id,
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          startDate: input.startDate,
          dueDate: input.dueDate,
          assigneeIds: input.assigneeIds,
          labelIds: input.labelIds,
        },
      });
      return mapTask(data.updateTask);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await graphqlClient.request<{ deleteTask: boolean }>(DELETE_TASK, {
        input: { id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useReorderTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      newOrder,
      newStatus,
    }: {
      id: string;
      newOrder: number;
      newStatus?: TaskStatus;
    }): Promise<Task> => {
      const data = await graphqlClient.request<{
        reorderTask: TaskResponse;
      }>(REORDER_TASK, { input: { id, newOrder, newStatus } });
      return mapTask(data.reorderTask);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useAllTasks(filters: { projectId?: string } = {}) {
  return useQuery({
    queryKey: ["allTasks", filters],
    queryFn: async (): Promise<Task[]> => {
      const data = await graphqlClient.request<{
        listAllTasks: TaskResponse[];
      }>(LIST_ALL_TASKS, {
        input: {
          projectId: filters.projectId,
        },
      });
      return data.listAllTasks.map(mapTask);
    },
  });
}
