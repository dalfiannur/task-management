import { useQuery, useMutation, gql } from "@/lib/graphql-client";
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

// --- Hooks ---

export function useModules(projectId?: string) {
  const { data, loading, error } = useQuery<{ listModules: Module[] }>(
    LIST_MODULES,
    {
      variables: { input: { projectId } },
      skip: !projectId,
    },
  );

  return {
    data: data?.listModules,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useModule(id: string) {
  const { data, loading, error } = useQuery<{
    getModule: Module | null;
  }>(GET_MODULE, {
    variables: { input: { id } },
    skip: !id,
  });

  return {
    data: data?.getModule ?? null,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useCreateModule() {
  const [exec, { loading }] = useMutation<{ createModule: Module }>(
    CREATE_MODULE,
  );

  return {
    mutate: (
      input: { name: string; description?: string; projectId: string },
      opts?: { onSuccess?: (data: Module) => void },
    ) => {
      exec({
        variables: {
          input: {
            name: input.name,
            description: input.description,
            projectId: input.projectId,
          },
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.createModule);
      });
    },
    mutateAsync: async (input: {
      name: string;
      description?: string;
      projectId: string;
    }): Promise<Module> => {
      const res = await exec({
        variables: {
          input: {
            name: input.name,
            description: input.description,
            projectId: input.projectId,
          },
        },
      });
      return res.data!.createModule;
    },
    isPending: loading,
  };
}

export function useUpdateModule() {
  const [exec, { loading }] = useMutation<{ updateModule: Module }>(
    UPDATE_MODULE,
  );

  return {
    mutate: (
      vars: { id: string; input: { name?: string; description?: string } },
      opts?: { onSuccess?: (data: Module) => void },
    ) => {
      exec({
        variables: {
          input: {
            id: vars.id,
            name: vars.input.name,
            description: vars.input.description,
          },
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.updateModule);
      });
    },
    mutateAsync: async (vars: {
      id: string;
      input: { name?: string; description?: string };
    }): Promise<Module> => {
      const res = await exec({
        variables: {
          input: {
            id: vars.id,
            name: vars.input.name,
            description: vars.input.description,
          },
        },
      });
      return res.data!.updateModule;
    },
    isPending: loading,
  };
}

export function useDeleteModule() {
  const [exec, { loading }] = useMutation<{ deleteModule: boolean }>(
    DELETE_MODULE,
  );

  return {
    mutate: (id: string, opts?: { onSuccess?: () => void }) => {
      exec({ variables: { input: { id } } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (id: string): Promise<void> => {
      await exec({ variables: { input: { id } } });
    },
    isPending: loading,
  };
}
