import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { coreGraphClient, graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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

const GET_PROJECT_CORE = gql`
  query GetProjectCore($input: getProjectInput!) {
    getProject(input: $input) {
      id
      code
      name {
        name
        description
      }
      status
      winStage
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
  return useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<(Project & { coreDetail: ProjectCore | null })[]> => {
      const projects = await graphqlClient
        .request<{ listProjects: Project[] }>(LIST_PROJECTS)
        .then((res) => res.listProjects);

      return Promise.all(
        projects.map((project) => {
          if (!project.coreRef?.value) {
            return { ...project, coreDetail: null };
          }
          return coreGraphClient
            .request<{ getProject: ProjectCore | null }>(GET_PROJECT_CORE, {
              input: { id: project.coreRef.value },
            })
            .then((res) => ({ ...project, coreDetail: res.getProject }))
            .catch(() => ({ ...project, coreDetail: null }));
        })
      );
    },
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: async (): Promise<Project & { coreDetail: ProjectCore | null } | null> => {
      const data = await graphqlClient.request<{
        getProject: Project | null;
      }>(GET_PROJECT, { input: { id } });

      if (!data.getProject) return null

      if (!data.getProject.coreRef?.value) {
        return { ...data.getProject, coreDetail: null };
      }

      const core = await coreGraphClient.request<{
        getProject: ProjectCore | null
      }>(GET_PROJECT_CORE, { input: { id: data.getProject.coreRef.value } })

      return {
        ...data.getProject,
        coreDetail: core.getProject
      }
    },
    enabled: !!id,
  });
}

export function useApproveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      description?: string;
    }): Promise<Project> => {
      const data = await graphqlClient.request<{
        approveProject: Project;
      }>(APPROVE_PROJECT, {
        input: {
          id: input.id,
          description: input.description,
        },
      });
      return data.approveProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      description?: string;
      status?: string;
      picId?: string;
    }): Promise<Project> => {
      const data = await graphqlClient.request<{
        updateProject: Project;
      }>(UPDATE_PROJECT, { input });
      return data.updateProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await graphqlClient.request<{ deleteProject: boolean }>(DELETE_PROJECT, {
        input: { id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
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
  return useQuery({
    queryKey: ["projects", "sub", parentProjectId],
    queryFn: async () => {
      const data = await graphqlClient.request<{
        listSubProjects: Project[];
      }>(LIST_SUB_PROJECTS, { input: { parentProjectId } });
      return data.listSubProjects.map((p) => ({
        ...p,
        coreDetail: null as ProjectCore | null,
      }));
    },
    enabled: !!parentProjectId,
  });
}

export function useCreateSubProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSubProjectInput): Promise<Project> => {
      const data = await graphqlClient.request<{
        createSubProject: Project;
      }>(CREATE_SUB_PROJECT, { input });
      return data.createSubProject;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({
        queryKey: ["projects", "sub", variables.parentProjectId],
      });
    },
  });
}

export function getProjectDisplayName(
  project: Project & { coreDetail: ProjectCore | null },
): string {
  return project.name?.value || project.coreDetail?.name.name || "Untitled";
}
