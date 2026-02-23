import { useQuery, useMutation, gql, coreClient } from "@/lib/graphql-client";
import type { Project, ProjectCore, ProjectStatus } from "@/types/project";

const LIST_PROJECTS = gql`
  query ListLeadProjects {
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
  mutation ApproveLeadProject($input: updateProjectInput!) {
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
      winStage: p.winStage,
    },
  };
}

export function useNewLeads() {
  const { data, loading, error } = useQuery<{
    listProjects: ProjectCore[];
  }>(LIST_PROJECTS, {
    client: coreClient,
  });

  return {
    data: data?.listProjects.map(mapCoreProject),
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useApproveLead() {
  const [exec, { loading }] = useMutation<{ updateProject: ProjectCore }>(
    APPROVE_PROJECT,
    { client: coreClient },
  );

  return {
    mutate: (
      input: { id: string; winStage: string },
      opts?: { onSuccess?: (data: ProjectCore) => void },
    ) => {
      exec({ variables: { input } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.updateProject);
      });
    },
    mutateAsync: async (input: {
      id: string;
      winStage: string;
    }): Promise<ProjectCore> => {
      const res = await exec({ variables: { input } });
      return res.data!.updateProject;
    },
    isPending: loading,
  };
}
