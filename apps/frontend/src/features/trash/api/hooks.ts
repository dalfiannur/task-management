// Project trash (connect-query over ProjectTrashService). Admin only. A
// restore or purge also refreshes project lists.

import { useMemo } from "react";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
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
