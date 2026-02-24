import { useQuery, gql, coreClient } from "@/lib/graphql-client";
import { createMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { Project, ProjectStatus } from "@/types/project";

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

/** Raw Core project shape from the Core GraphQL API. */
interface CoreProjectRaw {
  id: string;
  code: string;
  name: { name: string; description: string };
  status: string;
  winStage: string;
}

function mapCoreProject(p: CoreProjectRaw): Project {
  return {
    id: p.id,
    coreRef: { value: p.id },
    status: { value: p.status as ProjectStatus },
    description: p.name.description,
    code: p.code,
    coreName: p.name.name,
    coreDescription: p.name.description,
    winStage: p.winStage,
  };
}

export function useNewLeads() {
  const result = useQuery<{ listProjects: CoreProjectRaw[] }>(LIST_PROJECTS, {
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.listProjects.map(mapCoreProject));
}

export const useApproveLead = createMutationHook<
  { id: string; winStage: string },
  CoreProjectRaw
>({
  mutation: APPROVE_PROJECT,
  responseKey: "updateProject",
  client: coreClient,
});
