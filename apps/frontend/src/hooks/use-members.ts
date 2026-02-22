import { useMutation, useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";
import { graphqlClient } from "@/lib/graphql-client";
import { queryClient } from "@/lib/query-client";

const LIST_PROJECT_MEMBERS = gql`
  query ListProjectMembers($input: listProjectMembersInput!) {
    listProjectMembers(input: $input) {
      id
      membership {
        projectId
        userId
      }
    }
  }
`;

const ADD_PROJECT_MEMBER = gql`
  mutation AddProjectMember($input: addProjectMemberInput!) {
    addProjectMember(input: $input)
  }
`;

const REMOVE_PROJECT_MEMBER = gql`
  mutation RemoveProjectMember($input: removeProjectMemberInput!) {
    removeProjectMember(input: $input)
  }
`;

export interface ProjectMember {
  id: string;
  membership: {
    projectId: string;
    userId: string;
  };
}

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: ["project-members", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectMember[]> => {
      const data = await graphqlClient.request<{
        listProjectMembers: ProjectMember[];
      }>(LIST_PROJECT_MEMBERS, { input: { projectId } });
      return data.listProjectMembers;
    },
  });
}

export function useAddProjectMember() {
  return useMutation({
    mutationFn: async (input: { projectId: string; userId: string }) => {
      await graphqlClient.request(ADD_PROJECT_MEMBER, { input });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["project-members", variables.projectId],
      });
    },
  });
}

export function useRemoveProjectMember() {
  return useMutation({
    mutationFn: async (input: { projectId: string; userId: string }) => {
      await graphqlClient.request(REMOVE_PROJECT_MEMBER, { input });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["project-members", variables.projectId],
      });
    },
  });
}
