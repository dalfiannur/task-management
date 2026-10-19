// Project trash (connect-query over ProjectTrashService). Admin only. A
// restore or purge also refreshes project lists.

import { useMemo } from "react";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
import { ProjectTrashService } from "@/lib/gen/trash_pb";
import { ProjectService } from "@/lib/gen/projects_pb";
import { queryClient } from "@/lib/query";

export interface DeletedProject {
  id: string;
  name: string;
  ownerId: string;
  deletedAt: string;
  deletedBy: string;
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
      })),
    [result.data],
  );
  return { ...result, projects, leftoverCount: result.data?.leftoverCount ?? 0 };
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
