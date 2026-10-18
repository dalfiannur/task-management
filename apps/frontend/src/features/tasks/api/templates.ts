// Task templates (connect-query over TemplateService). Creating from one also
// refreshes the task lists.

import { useMemo } from "react";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
import { TemplateService, type TaskTemplate as PbTemplate } from "@/lib/gen/templates_pb";
import { TaskService } from "@/lib/gen/work_pb";
import { queryClient } from "@/lib/query";
import type { TaskPriority } from "../types";
import { priorityFromProto } from "./mappers";

export interface TaskTemplate {
  id: string;
  projectId: string;
  name: string;
  title: string;
  priority: TaskPriority;
  estimateMinutes?: number;
  labelIds: string[];
  subtasks: string[];
  createdBy: string;
}

function mapTemplate(t: PbTemplate): TaskTemplate {
  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    title: t.title,
    priority: priorityFromProto(t.priority),
    estimateMinutes: t.estimateMinutes,
    labelIds: [...t.labelIds],
    subtasks: [...t.subtasks],
    createdBy: t.createdBy,
  };
}

const invalidate = (schema: typeof TemplateService | typeof TaskService) =>
  queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({ schema, cardinality: "finite" }),
  });

export function useTaskTemplates(projectId: string, enabled = true) {
  const result = useQuery(
    TemplateService.method.listTaskTemplates,
    { projectId },
    { enabled: enabled && !!projectId },
  );
  const templates = useMemo(
    () => (result.data?.templates ?? []).map(mapTemplate),
    [result.data],
  );
  return { ...result, templates };
}

export function useSaveTaskTemplate() {
  return useMutation(TemplateService.method.saveTaskTemplate, {
    onSuccess: () => invalidate(TemplateService),
  });
}

export function useDeleteTaskTemplate() {
  return useMutation(TemplateService.method.deleteTaskTemplate, {
    onSuccess: () => invalidate(TemplateService),
  });
}

export function useCreateTaskFromTemplate() {
  return useMutation(TemplateService.method.createTaskFromTemplate, {
    onSuccess: () => invalidate(TaskService),
  });
}
