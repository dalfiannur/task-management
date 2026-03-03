import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { CreateProjectInput, CreateSubProjectInput, Project, ProjectStatus } from "@/types/project";

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
    linkedModule {
      id
      name
    }
    code {
      value
    }
    coreName {
      value
    }
    coreDescription {
      value
    }
    clientName {
      value
    }
    clientLegalName {
      value
    }
    winStage {
      value
    }
    resolvedStatus {
      value
    }
    closedAt {
      value
    }
  }
`;

/** Raw shape from GraphQL (enrichment fields wrapped as { value }) */
interface ProjectRaw {
  id: string;
  coreRef: { value: string };
  status: { value: string };
  projectLeaderId?: { value: string };
  name?: { value: string };
  parent?: { id: string } | null;
  linkedModule?: { id: string; name: string } | null;
  code?: { value: string };
  coreName?: { value: string };
  coreDescription?: { value: string };
  clientName?: { value: string };
  clientLegalName?: { value: string };
  winStage?: { value: string };
  resolvedStatus?: { value: string };
  closedAt?: { value: string };
}

function mapProject(raw: ProjectRaw): Project {
  return {
    id: raw.id,
    coreRef: raw.coreRef,
    status: raw.status as { value: ProjectStatus },
    projectLeaderId: raw.projectLeaderId,
    name: raw.name,
    parent: raw.parent,
    linkedModule: raw.linkedModule ?? null,
    code: raw.code?.value,
    coreName: raw.coreName?.value,
    coreDescription: raw.coreDescription?.value,
    clientName: raw.clientName?.value,
    clientLegalName: raw.clientLegalName?.value,
    winStage: raw.winStage?.value,
    resolvedStatus: raw.resolvedStatus?.value,
    closedAt: raw.closedAt?.value,
  };
}

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

const CLOSE_PROJECT = gql`
  ${PROJECT_FIELDS}
  mutation CloseProject($input: closeProjectInput!) {
    closeProject(input: $input) {
      ...ProjectFields
    }
  }
`;

const CREATE_PROJECT = gql`
  ${PROJECT_FIELDS}
  mutation CreateProject($input: createProjectInput!) {
    createProject(input: $input) {
      ...ProjectFields
    }
  }
`;

// --- Hooks ---

export function useProjects() {
  const result = useQuery<{ listProjects: ProjectRaw[] }>(LIST_PROJECTS);
  return normalizeQueryResult(result, (d) => d.listProjects.map(mapProject));
}

export function useProject(id: string) {
  const result = useQuery<{ getProject: ProjectRaw | null }>(GET_PROJECT, {
    variables: { input: { id } },
    skip: !id,
  });
  return normalizeQueryResult(result, (d) =>
    d.getProject ? mapProject(d.getProject) : null,
  );
}

export const useCreateProject = createMutationHook<
  CreateProjectInput,
  ProjectRaw,
  Project
>({
  mutation: CREATE_PROJECT,
  responseKey: "createProject",
  mapResponse: mapProject,
  refetchQueries: [LIST_PROJECTS],
});

export const useApproveProject = createMutationHook<
  { id: string; description?: string },
  ProjectRaw,
  Project
>({
  mutation: APPROVE_PROJECT,
  responseKey: "approveProject",
  mapVariables: (input) => ({
    input: { id: input.id, description: input.description },
  }),
  mapResponse: mapProject,
  refetchQueries: [LIST_PROJECTS],
});

export const useUpdateProject = createMutationHook<
  { id: string; description?: string; status?: string; projectLeaderId?: string; moduleId?: string | null },
  ProjectRaw,
  Project
>({
  mutation: UPDATE_PROJECT,
  responseKey: "updateProject",
  mapResponse: mapProject,
  refetchQueries: [LIST_PROJECTS, GET_PROJECT],
});

export const useDeleteProject = createVoidMutationHook<string>({
  mutation: DELETE_PROJECT,
  mapVariables: (id) => ({ input: { id } }),
  refetchQueries: [LIST_PROJECTS],
});

export const useCloseProject = createMutationHook<
  { id: string },
  ProjectRaw,
  Project
>({
  mutation: CLOSE_PROJECT,
  responseKey: "closeProject",
  mapResponse: mapProject,
  refetchQueries: [LIST_PROJECTS, GET_PROJECT],
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
  const result = useQuery<{ listSubProjects: ProjectRaw[] }>(LIST_SUB_PROJECTS, {
    variables: { input: { parentProjectId } },
    skip: !parentProjectId,
  });
  return normalizeQueryResult(result, (d) => d.listSubProjects.map(mapProject));
}

export const useCreateSubProject = createMutationHook<
  CreateSubProjectInput,
  ProjectRaw,
  Project
>({
  mutation: CREATE_SUB_PROJECT,
  responseKey: "createSubProject",
  mapResponse: mapProject,
  refetchQueries: [LIST_SUB_PROJECTS, LIST_PROJECTS],
});

export function getProjectDisplayName(project: Project): string {
  return project.name?.value || project.coreName || "Untitled";
}
