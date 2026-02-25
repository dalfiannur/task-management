import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { Module } from "@/types/task";

// --- GraphQL operations ---

const MODULE_FIELDS = gql`
  fragment ModuleFields on Module {
    id
    name
    description
    picId {
      value
    }
    project {
      id
    }
  }
`;

const LIST_MODULES = gql`
  ${MODULE_FIELDS}
  query ListModules($input: listModulesInput!) {
    listModules(input: $input) {
      ...ModuleFields
    }
  }
`;

const GET_MODULE = gql`
  ${MODULE_FIELDS}
  query GetModule($input: getModuleInput!) {
    getModule(input: $input) {
      ...ModuleFields
    }
  }
`;

const CREATE_MODULE = gql`
  ${MODULE_FIELDS}
  mutation CreateModule($input: createModuleInput!) {
    createModule(input: $input) {
      ...ModuleFields
    }
  }
`;

const UPDATE_MODULE = gql`
  ${MODULE_FIELDS}
  mutation UpdateModule($input: updateModuleInput!) {
    updateModule(input: $input) {
      ...ModuleFields
    }
  }
`;

const LIST_ALL_MODULES = gql`
  query ListAllModules($input: listAllModulesInput!) {
    listAllModules(input: $input) {
      id
      name
      project {
        id
      }
    }
  }
`;

const DELETE_MODULE = gql`
  mutation DeleteModule($input: deleteModuleInput!) {
    deleteModule(input: $input)
  }
`;

// --- Response types & mappers ---

interface ModuleResponse {
  id: string;
  name: string;
  description?: string;
  picId?: { value: string };
}

function mapModule(raw: ModuleResponse): Module {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    picId: raw.picId?.value || undefined,
  };
}

// --- Hooks ---

export function useModules(projectId?: string) {
  const result = useQuery<{ listModules: ModuleResponse[] }>(LIST_MODULES, {
    variables: { input: { projectId } },
    skip: !projectId,
  });
  return normalizeQueryResult(result, (d) => d.listModules.map(mapModule));
}

export function useModule(id: string) {
  const result = useQuery<{ getModule: ModuleResponse | null }>(GET_MODULE, {
    variables: { input: { id } },
    skip: !id,
  });
  return normalizeQueryResult(result, (d) => d.getModule ? mapModule(d.getModule) : null);
}

export const useCreateModule = createMutationHook<
  { name: string; description?: string; projectId: string; picId?: string },
  ModuleResponse,
  Module
>({
  mutation: CREATE_MODULE,
  responseKey: "createModule",
  mapResponse: mapModule,
  refetchQueries: [LIST_MODULES],
});

export const useUpdateModule = createMutationHook<
  { id: string; input: { name?: string; description?: string; picId?: string } },
  ModuleResponse,
  Module
>({
  mutation: UPDATE_MODULE,
  responseKey: "updateModule",
  mapVariables: (vars) => ({
    input: { id: vars.id, name: vars.input.name, description: vars.input.description, picId: vars.input.picId },
  }),
  mapResponse: mapModule,
  refetchQueries: [LIST_MODULES],
});

export const useDeleteModule = createVoidMutationHook<string>({
  mutation: DELETE_MODULE,
  mapVariables: (id) => ({ input: { id } }),
  refetchQueries: [LIST_MODULES],
});

export interface ModuleWithProject {
  id: string;
  name: string;
  projectId: string;
}

interface AllModuleResponse {
  id: string;
  name: string;
  project?: { id: string } | null;
}

export function useAllModules() {
  const result = useQuery<{ listAllModules: AllModuleResponse[] }>(LIST_ALL_MODULES, {
    variables: { input: {} },
  });
  return normalizeQueryResult(result, (d) =>
    d.listAllModules
      .filter((m): m is AllModuleResponse & { project: { id: string } } => !!m.project?.id)
      .map((m) => ({ id: m.id, name: m.name, projectId: m.project.id })),
  );
}
