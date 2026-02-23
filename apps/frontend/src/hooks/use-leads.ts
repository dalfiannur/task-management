import { useQuery, gql, coreClient } from "@/lib/graphql-client";
import { createMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { Project, ProjectCore, ProjectStatus } from "@/types/project";

const LIST_PROJECTS = gql`
  query ListLeadProjects {
    listProjects(input: {winStage: pending}) {
      id
      code
      name {
        description
        name
      }
      status
      winStage
    }
  }
`;

const APPROVE_PROJECT = gql`
  mutation ApproveLeadProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      id
      code
      name {
        description
        name
      }
      status
      winStage
    }
  }
`;

type ProjectWithCore = Project & { coreDetail: ProjectCore | null };

function mapCoreProject(p: ProjectCore): ProjectWithCore {
  return {
    id: p.id,
    coreRef: { value: p.id },
    status: { value: p.status as ProjectStatus },
    description: p.name.description,
    coreDetail: {
      id: p.id,
      code: p.code,
      name: { name: p.name.name, description: p.name.description },
      status: p.status,
      winStage: p.winStage,
    },
  };
}

export function useNewLeads() {
  const result = useQuery<{ listProjects: ProjectCore[] }>(LIST_PROJECTS, {
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.listProjects.map(mapCoreProject));
}

export const useApproveLead = createMutationHook<
  { id: string; winStage: string },
  ProjectCore
>({
  mutation: APPROVE_PROJECT,
  responseKey: "updateProject",
  client: coreClient,
});
