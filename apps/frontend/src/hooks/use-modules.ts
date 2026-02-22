import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
import type { Module } from "@/types/task";

// --- GraphQL operations ---

const MODULE_FIELDS = gql`
  fragment ModuleFields on Module {
    id
    name
    description
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

const DELETE_MODULE = gql`
  mutation DeleteModule($input: deleteModuleInput!) {
    deleteModule(input: $input)
  }
`;

// --- Response type from Bunsane ---

interface ModuleResponse {
  id: string;
  moduleInfo: {
    name: string;
    description: string;
    projectId: string;
  };
}

// --- Hooks ---

export function useModules(projectId?: string) {
  return useQuery({
    queryKey: ["modules", { projectId }],
    queryFn: async (): Promise<Module[]> => {
      if (!projectId) return [];
      const data = await graphqlClient.request<{
        listModules: Module[];
      }>(LIST_MODULES, { input: { projectId } });
      return data.listModules
    },
    enabled: !!projectId,
  });
}

export function useModule(id: string) {
  return useQuery({
    queryKey: ["modules", id],
    queryFn: async (): Promise<Module | null> => {
      const data = await graphqlClient.request<{
        getModule: Module | null;
      }>(GET_MODULE, { input: { id } });
      return data.getModule;
    },
    enabled: !!id,
  });
}

export function useCreateModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      projectId: string;
    }): Promise<Module> => {
      const data = await graphqlClient.request<{
        createModule: Module;
      }>(CREATE_MODULE, {
        input: {
          name: input.name,
          description: input.description,
          projectId: input.projectId,
        },
      });
      return data.createModule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modules"] });
    },
  });
}

export function useUpdateModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: { name?: string; description?: string };
    }): Promise<Module> => {
      const data = await graphqlClient.request<{
        updateModule: Module;
      }>(UPDATE_MODULE, {
        input: {
          id,
          name: input.name,
          description: input.description,
        },
      });
      return data.updateModule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modules"] });
    },
  });
}

export function useDeleteModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await graphqlClient.request<{ deleteModule: boolean }>(DELETE_MODULE, {
        input: { id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modules"] });
    },
  });
}
