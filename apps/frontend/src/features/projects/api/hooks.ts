// Projects RPC hooks (connect-query). Reads map proto→flat; writes invalidate
// the whole ProjectService key so list + detail refetch.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { useMemo } from "react";
import { ProjectService } from "@/lib/gen/projects_pb";
import { queryClient } from "@/lib/query";
import type { ProjectList, ProjectStatus } from "../types";
import { mapProject, statusToProto } from "./mappers";

const PAGE_SIZE = 12;

function invalidateProjects() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: ProjectService,
      cardinality: "finite",
    }),
  });
}

export interface ProjectsQuery {
  statuses: ProjectStatus[];
  search?: string;
  page: number;
}

/** Member-scoped, filtered, paginated list. */
export function useProjects({ statuses, search, page }: ProjectsQuery) {
  const result = useQuery(ProjectService.method.listProjects, {
    status: statuses.map(statusToProto),
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const data: ProjectList = {
    projects: result.data?.projects.map(mapProject) ?? [],
    total: result.data?.total ?? 0,
  };
  return { ...result, data, pageSize: PAGE_SIZE };
}

/** Single project (member-gated; PERMISSION_DENIED surfaces as error). */
export function useProject(id: string) {
  const result = useQuery(
    ProjectService.method.getProject,
    { id },
    { enabled: !!id },
  );
  return { ...result, project: result.data ? mapProject(result.data) : null };
}

/** Member roster of a project (read). Used by assignee pickers + the members tab.
 *  `members`/`memberIds` are memoized on the query data: callers derive editor
 *  extensions and other memo deps from them, and a fresh array each render would
 *  churn those (tiptap's mention extension is only read when the editor is
 *  created, so the churn is silent). */
export function useProjectMembers(projectId: string) {
  const result = useQuery(
    ProjectService.method.listProjectMembers,
    { projectId },
    { enabled: !!projectId },
  );
  const members = useMemo(() => result.data?.members ?? [], [result.data]);
  const memberIds = useMemo(() => members.map((m) => m.userId), [members]);
  return {
    ...result,
    members,
    memberIds,
    ownerId: result.data?.ownerId ?? "",
  };
}

export function useCreateProject() {
  return useMutation(ProjectService.method.createProject, {
    onSuccess: invalidateProjects,
  });
}

export function useSetProjectStatus() {
  return useMutation(ProjectService.method.setProjectStatus, {
    onSuccess: invalidateProjects,
  });
}

export function useTransferOwnership() {
  return useMutation(ProjectService.method.transferProjectOwnership, {
    onSuccess: invalidateProjects,
  });
}

export function useDeleteProject() {
  return useMutation(ProjectService.method.deleteProject, {
    onSuccess: invalidateProjects,
  });
}
