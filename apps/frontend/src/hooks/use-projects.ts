import { useState, useEffect } from "react";
import { useQuery, useMutation, gql, CORE_URL, getAuthToken } from "@/lib/graphql-client";
import type { CreateSubProjectInput, Project, ProjectCore } from "@/types/project";

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
    picId {
      value
    }
    name {
      value
    }
    parent {
      id
    }
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
  const { data, loading, error } = useQuery<{ listProjects: Project[] }>(
    LIST_PROJECTS,
  );

  const projects = data?.listProjects;

  const [enrichedProjects, setEnrichedProjects] = useState<
    (Project & { coreDetail: ProjectCore | null })[] | undefined
  >(undefined);

  useEffect(() => {
    if (!projects) return;

    Promise.all(
      projects.map((project) => {
        if (!project.coreRef?.value) {
          return Promise.resolve({ ...project, coreDetail: null });
        }
        return fetch(CORE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
          },
          body: JSON.stringify({
            query: `query GetProjectCore($input: getProjectInput!) {
              getProject(input: $input) {
                id
                code
                name { name description }
                status
                winStage
              }
            }`,
            variables: { input: { id: project.coreRef.value } },
          }),
        })
          .then((r) => r.json())
          .then((res: { data?: { getProject: ProjectCore | null } }) => ({
            ...project,
            coreDetail: res.data?.getProject ?? null,
          }))
          .catch(() => ({ ...project, coreDetail: null }));
      }),
    ).then(setEnrichedProjects);
  }, [projects]);

  return {
    data: enrichedProjects,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useProject(id: string) {
  const { data, loading, error } = useQuery<{
    getProject: Project | null;
  }>(GET_PROJECT, {
    variables: { input: { id } },
    skip: !id,
  });

  const [enriched, setEnriched] = useState<
    (Project & { coreDetail: ProjectCore | null }) | null | undefined
  >(undefined);

  const project = data?.getProject;

  useEffect(() => {
    if (project === undefined) return;
    if (project === null) {
      setEnriched(null);
      return;
    }

    if (!project.coreRef?.value) {
      setEnriched({ ...project, coreDetail: null });
      return;
    }

    fetch(CORE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
      },
      body: JSON.stringify({
        query: `query GetProjectCore($input: getProjectInput!) {
          getProject(input: $input) {
            id
            code
            name { name description }
            status
            winStage
          }
        }`,
        variables: { input: { id: project.coreRef.value } },
      }),
    })
      .then((r) => r.json())
      .then((res: { data?: { getProject: ProjectCore | null } }) =>
        setEnriched({
          ...project,
          coreDetail: res.data?.getProject ?? null,
        }),
      )
      .catch(() => setEnriched({ ...project, coreDetail: null }));
  }, [project]);

  return {
    data: enriched,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useApproveProject() {
  const [exec, { loading }] = useMutation<{ approveProject: Project }>(
    APPROVE_PROJECT,
  );

  return {
    mutate: (
      input: { id: string; description?: string },
      opts?: { onSuccess?: (data: Project) => void },
    ) => {
      exec({
        variables: { input: { id: input.id, description: input.description } },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.approveProject);
      });
    },
    mutateAsync: async (input: {
      id: string;
      description?: string;
    }): Promise<Project> => {
      const res = await exec({
        variables: { input: { id: input.id, description: input.description } },
      });
      return res.data!.approveProject;
    },
    isPending: loading,
  };
}

export function useUpdateProject() {
  const [exec, { loading }] = useMutation<{ updateProject: Project }>(
    UPDATE_PROJECT,
  );

  return {
    mutate: (
      input: {
        id: string;
        description?: string;
        status?: string;
        picId?: string;
      },
      opts?: { onSuccess?: (data: Project) => void },
    ) => {
      exec({ variables: { input } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.updateProject);
      });
    },
    mutateAsync: async (input: {
      id: string;
      description?: string;
      status?: string;
      picId?: string;
    }): Promise<Project> => {
      const res = await exec({ variables: { input } });
      return res.data!.updateProject;
    },
    isPending: loading,
  };
}

export function useDeleteProject() {
  const [exec, { loading }] = useMutation<{ deleteProject: boolean }>(
    DELETE_PROJECT,
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
  const { data, loading, error } = useQuery<{
    listSubProjects: Project[];
  }>(LIST_SUB_PROJECTS, {
    variables: { input: { parentProjectId } },
    skip: !parentProjectId,
  });

  return {
    data: data?.listSubProjects.map((p) => ({
      ...p,
      coreDetail: null as ProjectCore | null,
    })),
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useCreateSubProject() {
  const [exec, { loading }] = useMutation<{ createSubProject: Project }>(
    CREATE_SUB_PROJECT,
  );

  return {
    mutate: (
      input: CreateSubProjectInput,
      opts?: { onSuccess?: (data: Project) => void },
    ) => {
      exec({ variables: { input } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.createSubProject);
      });
    },
    mutateAsync: async (input: CreateSubProjectInput): Promise<Project> => {
      const res = await exec({ variables: { input } });
      return res.data!.createSubProject;
    },
    isPending: loading,
  };
}

export function getProjectDisplayName(
  project: Project & { coreDetail: ProjectCore | null },
): string {
  return project.name?.value || project.coreDetail?.name.name || "Untitled";
}
