import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { CreateSubProjectInput, Project } from "@/types/project";

// --- GraphQL operations ---

const PROJECT_FIELDS = gql`
  fragment ProjectFields on Project {
    id
    coreRef {
      value
    }
    status {
      value
    }
    projectLeaderId {
      value
    }
    name {
      value
    }
    parent {
      id
    }
    code
    coreName
    coreDescription
    clientName
    clientLegalName
    winStage
    resolvedStatus
  }
`;

const LIST_PROJECTS = gql`
  ${PROJECT_FIELDS}
  query ListProjects {
    listProjects {
      ...ProjectFields
    }
  }
`;

const GET_PROJECT = gql`
  ${PROJECT_FIELDS}
  query GetProject($input: getProjectInput!) {
    getProject(input: $input) {
      ...ProjectFields
    }
  }
`;

const APPROVE_PROJECT = gql`
  ${PROJECT_FIELDS}
  mutation ApproveProject($input: approveProjectInput!) {
    approveProject(input: $input) {
      ...ProjectFields
    }
  }
`;

const UPDATE_PROJECT = gql`
  ${PROJECT_FIELDS}
  mutation UpdateProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      ...ProjectFields
    }
  }
`;

const DELETE_PROJECT = gql`
  mutation DeleteProject($input: deleteProjectInput!) {
    deleteProject(input: $input)
  }
`;

// --- Hooks ---

export function useProjects() {
  const result = useQuery<{ listProjects: Project[] }>(LIST_PROJECTS);
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export function useProject(id: string) {
  const result = useQuery<{ getProject: Project | null }>(GET_PROJECT, {
    variables: { input: { id } },
    skip: !id,
  });
  return normalizeQueryResult(result, (d) => d.getProject);
}

export const useApproveProject = createMutationHook<
  { id: string; description?: string },
  Project
>({
  mutation: APPROVE_PROJECT,
  responseKey: "approveProject",
  mapVariables: (input) => ({
    input: { id: input.id, description: input.description },
  }),
});

export const useUpdateProject = createMutationHook<
  { id: string; description?: string; status?: string; projectLeaderId?: string },
  Project
>({
  mutation: UPDATE_PROJECT,
  responseKey: "updateProject",
});

export const useDeleteProject = createVoidMutationHook<string>({
  mutation: DELETE_PROJECT,
  mapVariables: (id) => ({ input: { id } }),
});

// --- Sub-Projects ---

const LIST_SUB_PROJECTS = gql`
  ${PROJECT_FIELDS}
  query ListSubProjects($input: listSubProjectsInput!) {
    listSubProjects(input: $input) {
      ...ProjectFields
    }
  }
`;

const CREATE_SUB_PROJECT = gql`
  ${PROJECT_FIELDS}
  mutation CreateSubProject($input: createSubProjectInput!) {
    createSubProject(input: $input) {
      ...ProjectFields
    }
  }
`;

export function useSubProjects(parentProjectId?: string) {
  const result = useQuery<{ listSubProjects: Project[] }>(LIST_SUB_PROJECTS, {
    variables: { input: { parentProjectId } },
    skip: !parentProjectId,
  });
  return normalizeQueryResult(result, (d) => d.listSubProjects);
}

export const useCreateSubProject = createMutationHook<
  CreateSubProjectInput,
  Project
>({
  mutation: CREATE_SUB_PROJECT,
  responseKey: "createSubProject",
});

export function getProjectDisplayName(project: Project): string {
  return project.name?.value || project.coreName || "Untitled";
}
