import { useMutation, useQuery } from "@tanstack/react-query";
import type { Project, ProjectCore, ProjectStatus } from "@/types/project";
import { coreGraphClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
import { queryClient } from "@/lib/query-client";

const LIST_PROJECTS = gql`
  query ListProjects {
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
  mutation ApproveProject($input: updateProjectInput!) {
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
      winStage: p.winStage
    },
  };
}

export function useNewLeads() {
  return useQuery({
    queryKey: ["leads"],
    queryFn: async (): Promise<ProjectWithCore[]> => {
      const data = await coreGraphClient.request<{
        listProjects: ProjectCore[];
      }>(LIST_PROJECTS);
      return data.listProjects.map(mapCoreProject);
    },
  });
}

export function useApproveLead() {
  return useMutation({
    mutationFn: async (input: { id: string; winStage: string; }): Promise<ProjectCore> => {
      const data = await coreGraphClient.request<{
        updateProject: ProjectCore;
      }>(APPROVE_PROJECT, { input });
      return data.updateProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
