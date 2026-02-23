import { useQuery, useMutation, gql } from "@/lib/graphql-client";

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
  const { data, loading, error } = useQuery<{
    listProjectMembers: ProjectMember[];
  }>(LIST_PROJECT_MEMBERS, {
    variables: { input: { projectId } },
    skip: !projectId,
  });

  return {
    data: data?.listProjectMembers,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useAddProjectMember() {
  const [exec, { loading }] = useMutation(ADD_PROJECT_MEMBER);

  return {
    mutate: (
      input: { projectId: string; userId: string },
      opts?: { onSuccess?: () => void },
    ) => {
      exec({ variables: { input } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (input: {
      projectId: string;
      userId: string;
    }): Promise<void> => {
      await exec({ variables: { input } });
    },
    isPending: loading,
  };
}

export function useRemoveProjectMember() {
  const [exec, { loading }] = useMutation(REMOVE_PROJECT_MEMBER);

  return {
    mutate: (
      input: { projectId: string; userId: string },
      opts?: { onSuccess?: () => void },
    ) => {
      exec({ variables: { input } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (input: {
      projectId: string;
      userId: string;
    }): Promise<void> => {
      await exec({ variables: { input } });
    },
    isPending: loading,
  };
}
