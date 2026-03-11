import { useQuery, useMutation, gql, coreClient } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { CoreProject, CreateProjectInput, CreateSubProjectInput, LocalProjectRef } from "@/types/project";

// --- GraphQL: Core Portal queries ---

const CORE_PROJECT_FIELDS = gql`
  fragment CoreProjectFields on Project {
    id
    code
    winStage
    commercial
    status
    name {
      name
      description
    }
    ref {
      divisionId
      eventId
      parentId
      companyId
      clientId
      leaderId
    }
    clientDetail {
      name {
        name
        legalName
      }
    }
  }
`;

const LIST_CORE_PROJECTS = gql`
  ${CORE_PROJECT_FIELDS}
  query ListCoreProjects($input: listProjectsInput!) {
    listProjects(input: $input) {
      ...CoreProjectFields
    }
  }
`;

const GET_CORE_PROJECT = gql`
  ${CORE_PROJECT_FIELDS}
  query GetCoreProject($input: getProjectInput!) {
    getProject(input: $input) {
      ...CoreProjectFields
    }
  }
`;

// --- GraphQL: Local backend queries ---

const LOCAL_PROJECT_FIELDS = gql`
  fragment LocalProjectFields on Project {
    id
    coreRef { value }
    projectLeaderId { value }
    parent { id }
    linkedModule { id name }
  }
`;

const LIST_LOCAL_PROJECTS = gql`
  ${LOCAL_PROJECT_FIELDS}
  query ListLocalProjects {
    listProjects {
      ...LocalProjectFields
    }
  }
`;

const GET_LOCAL_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  query GetLocalProject($input: getProjectInput!) {
    getProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

// --- GraphQL: Mutations (local backend) ---

const APPROVE_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation ApproveProject($input: approveProjectInput!) {
    approveProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const UPDATE_LOCAL_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation UpdateLocalProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const DELETE_PROJECT = gql`
  mutation DeleteProject($input: deleteProjectInput!) {
    deleteProject(input: $input)
  }
`;

const CREATE_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation CreateProject($input: createProjectInput!) {
    createProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const CREATE_SUB_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation CreateSubProject($input: createSubProjectInput!) {
    createSubProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const LIST_LOCAL_SUB_PROJECTS = gql`
  ${LOCAL_PROJECT_FIELDS}
  query ListLocalSubProjects($input: listSubProjectsInput!) {
    listSubProjects(input: $input) {
      ...LocalProjectFields
    }
  }
`;

// --- Core Portal update mutation ---

const UPDATE_CORE_PROJECT = gql`
  ${CORE_PROJECT_FIELDS}
  mutation UpdateCoreProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      ...CoreProjectFields
    }
  }
`;

// --- Hooks ---

export function useProjects(input?: {
  status?: string;
  parentId?: string;
  ownerId?: string;
  page?: number;
  limit?: number;
  commercial?: boolean;
}) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_CORE_PROJECTS, {
    client: coreClient,
    variables: { input },
    errorPolicy: "all",
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export function useProject(id: string) {
  const result = useQuery<{ getProject: CoreProject | null }>(GET_CORE_PROJECT, {
    variables: { input: { id } },
    client: coreClient,
    skip: !id,
    errorPolicy: "all",
  });
  return normalizeQueryResult(result, (d) => d.getProject);
}

/** Fetch local cross-ref data (linkedModule, parentRef) from task-management backend. */
export function useLocalProject(id: string) {
  const result = useQuery<{ getProject: LocalProjectRef | null }>(GET_LOCAL_PROJECT, {
    variables: { input: { id } },
    skip: !id,
  });
  return normalizeQueryResult(result, (d) => d.getProject);
}

/** Fetch sub-project local refs from task-management backend. */
export function useLocalSubProjects(parentProjectId?: string) {
  const result = useQuery<{ listSubProjects: LocalProjectRef[] }>(LIST_LOCAL_SUB_PROJECTS, {
    variables: { input: { parentProjectId } },
    skip: !parentProjectId,
  });
  return normalizeQueryResult(result, (d) => d.listSubProjects);
}

/** Fetch sub-projects from Core Portal by parentId. */
export function useSubProjects(parentProjectId?: string) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_CORE_PROJECTS, {
    client: coreClient,
    variables: { input: { parentId: parentProjectId } },
    skip: !parentProjectId,
    errorPolicy: "all",
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export const useCreateProject = createMutationHook<
  CreateProjectInput,
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: CREATE_PROJECT,
  responseKey: "createProject",
  refetchQueries: [LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

export const useApproveProject = createMutationHook<
  { id: string; description?: string },
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: APPROVE_PROJECT,
  responseKey: "approveProject",
  mapVariables: (input) => ({
    input: { id: input.id, description: input.description },
  }),
  refetchQueries: [LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

/** Update local cross-refs (moduleId, leaderId) on task-management backend. */
export const useUpdateLocalProject = createMutationHook<
  { id: string; projectLeaderId?: string; moduleId?: string | null },
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: UPDATE_LOCAL_PROJECT,
  responseKey: "updateProject",
});

/** Update project on Core Portal (status, winStage, etc.). */
export const useUpdateCoreProject = createMutationHook<
  { id: string; status?: string; winStage?: string; description?: string; projectLeaderId?: string },
  CoreProject,
  CoreProject
>({
  mutation: UPDATE_CORE_PROJECT,
  responseKey: "updateProject",
  client: coreClient,
});

export const useDeleteProject = createVoidMutationHook<string>({
  mutation: DELETE_PROJECT,
  mapVariables: (id) => ({ input: { id } }),
  refetchQueries: [LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

export function useCreateSubProject() {
  const [exec, { loading }] = useMutation<{ createSubProject: LocalProjectRef }>(
    CREATE_SUB_PROJECT,
    {
      refetchQueries: [LIST_LOCAL_SUB_PROJECTS, LIST_LOCAL_PROJECTS],
      onCompleted: () => {
        coreClient.refetchQueries({ include: [LIST_CORE_PROJECTS] });
      },
    },
  );

  return {
    mutate: (
      input: CreateSubProjectInput,
      opts?: { onSuccess?: (data: LocalProjectRef) => void },
    ) => {
      exec({ variables: { input } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.createSubProject);
      });
    },
    isLoading: loading,
  };
}

export function getProjectDisplayName(project: CoreProject): string {
  return project.name?.name || "Untitled";
}
