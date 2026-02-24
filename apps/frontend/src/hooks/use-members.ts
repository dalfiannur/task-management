import { useQuery, gql } from "@/lib/graphql-client";
import { createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";

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
  const result = useQuery<{ listProjectMembers: ProjectMember[] }>(
    LIST_PROJECT_MEMBERS,
    {
      variables: { input: { projectId } },
      skip: !projectId,
    },
  );
  return normalizeQueryResult(result, (d) => d.listProjectMembers);
}

export const useAddProjectMember = createVoidMutationHook<{
  projectId: string;
  userId: string;
}>({
  mutation: ADD_PROJECT_MEMBER,
  refetchQueries: [LIST_PROJECT_MEMBERS],
});

export const useRemoveProjectMember = createVoidMutationHook<{
  projectId: string;
  userId: string;
}>({
  mutation: REMOVE_PROJECT_MEMBER,
  refetchQueries: [LIST_PROJECT_MEMBERS],
});
