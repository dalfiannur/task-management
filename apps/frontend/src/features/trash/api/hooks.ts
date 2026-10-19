// Project trash (connect-query over ProjectTrashService). Admin only. A
// restore or purge also refreshes project lists.

import { useMemo } from "react";
import {
  createConnectQueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@connectrpc/connect-query";
import { ProjectTrashService } from "@/lib/gen/trash_pb";
import { ProjectService } from "@/lib/gen/projects_pb";
import { queryClient } from "@/lib/query";

/** What a purge removes. */
export interface ProjectContents {
  tasks: number;
  modules: number;
  pages: number;
  mediaFiles: number;
  mediaBytes: number;
  timeMinutes: number;
  comments: number;
  automations: number;
}

export interface DeletedProject {
  id: string;
  name: string;
  ownerId: string;
  deletedAt: string;
  deletedBy: string;
  contents: ProjectContents;
}

export type AuditAction =
  | "project_trashed"
  | "project_restored"
  | "project_purged"
  | "leftovers_purged";

/** One line of the workspace audit log (RFC-0004). */
export interface AuditEntry {
  id: string;
  actorId: string;
  /** Unknown actions from a newer server are kept as-is. */
  action: AuditAction | string;
  subjectId: string;
  subjectName: string;
  contents: ProjectContents;
  projects: number;
  createdAt: string;
}

function mapContents(c?: {
  tasks: number; modules: number; pages: number; mediaFiles: number; mediaBytes: bigint;
  timeMinutes: number; comments: number; automations: number;
}): ProjectContents {
  return {
    tasks: c?.tasks ?? 0,
    modules: c?.modules ?? 0,
    pages: c?.pages ?? 0,
    mediaFiles: c?.mediaFiles ?? 0,
    mediaBytes: Number(c?.mediaBytes ?? 0n),
    timeMinutes: c?.timeMinutes ?? 0,
    comments: c?.comments ?? 0,
    automations: c?.automations ?? 0,
  };
}

const refresh = () =>
  Promise.all(
    [ProjectTrashService, ProjectService].map((schema) =>
      queryClient.invalidateQueries({ queryKey: createConnectQueryKey({ schema, cardinality: "finite" }) }),
    ),
  );

export function useDeletedProjects() {
  const result = useQuery(ProjectTrashService.method.listDeletedProjects, {}, { staleTime: 0 });
  const projects = useMemo<DeletedProject[]>(
    () =>
      (result.data?.projects ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        ownerId: p.ownerId,
        deletedAt: p.deletedAt,
        deletedBy: p.deletedBy,
        contents: mapContents(p.contents),
      })),
    [result.data],
  );
  const leftoverContents = useMemo(() => mapContents(result.data?.leftoverContents), [result.data]);
  return { ...result, projects, leftoverCount: result.data?.leftoverCount ?? 0, leftoverContents };
}

export function useRestoreProject() {
  return useMutation(ProjectTrashService.method.restoreProject, { onSuccess: refresh });
}

export function usePurgeProject() {
  return useMutation(ProjectTrashService.method.purgeProject, { onSuccess: refresh });
}

export function usePurgeLeftovers() {
  return useMutation(ProjectTrashService.method.purgeLeftovers, { onSuccess: refresh });
}

const AUDIT_PAGE = 50;

/** The audit log, newest first, one page at a time ("Load older"). */
export function useAuditEntries() {
  const result = useInfiniteQuery(
    ProjectTrashService.method.listAuditEntries,
    { pageSize: AUDIT_PAGE, pageToken: "" },
    {
      pageParamKey: "pageToken",
      getNextPageParam: (last) => last.nextPageToken || undefined,
      staleTime: 0,
    },
  );
  const entries = useMemo<AuditEntry[]>(
    () =>
      (result.data?.pages ?? []).flatMap((page) =>
        page.entries.map((e) => ({
          id: e.id,
          actorId: e.actorId,
          action: e.action,
          subjectId: e.subjectId,
          subjectName: e.subjectName,
          contents: mapContents(e.contents),
          projects: e.projects,
          createdAt: e.createdAt,
        })),
      ),
    [result.data],
  );
  return { ...result, entries };
}
