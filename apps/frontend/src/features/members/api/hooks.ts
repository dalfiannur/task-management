// Membership mutations (connect-query over ProjectService). Reads use
// features/projects' useProjectMembers. Writes invalidate the ProjectService
// key so the roster (and list scoping) refetch.

import {
  useMutation,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { ProjectService } from "@/lib/gen/projects_pb";
import { queryClient } from "@/lib/query";

function invalidateProjects() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: ProjectService,
      cardinality: "finite",
    }),
  });
}

export function useAddMember() {
  return useMutation(ProjectService.method.addProjectMember, {
    onSuccess: invalidateProjects,
  });
}

export function useRemoveMember() {
  return useMutation(ProjectService.method.removeProjectMember, {
    onSuccess: invalidateProjects,
  });
}

export function useLeaveProject() {
  return useMutation(ProjectService.method.leaveProject, {
    onSuccess: invalidateProjects,
  });
}
