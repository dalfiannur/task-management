import { useQuery, useMutation, gql } from "@/lib/graphql-client";
import type { Label } from "@/types/task";

// --- GraphQL operations ---

const LABEL_FIELDS = gql`
  fragment LabelFields on Label {
    id
    labelInfo {
      name
      color
      projectId
    }
  }
`;

const LIST_LABELS = gql`
  ${LABEL_FIELDS}
  query ListLabels($input: listLabelsInput!) {
    listLabels(input: $input) {
      ...LabelFields
    }
  }
`;

const CREATE_LABEL = gql`
  ${LABEL_FIELDS}
  mutation CreateLabel($input: createLabelInput!) {
    createLabel(input: $input) {
      ...LabelFields
    }
  }
`;

const UPDATE_LABEL = gql`
  ${LABEL_FIELDS}
  mutation UpdateLabel($input: updateLabelInput!) {
    updateLabel(input: $input) {
      ...LabelFields
    }
  }
`;

const DELETE_LABEL = gql`
  mutation DeleteLabel($input: deleteLabelInput!) {
    deleteLabel(input: $input)
  }
`;

// --- Response type from Bunsane ---

interface LabelResponse {
  id: string;
  labelInfo: {
    name: string;
    color: string;
    projectId: string;
  };
}

function mapLabel(l: LabelResponse): Label {
  return {
    id: l.id,
    name: l.labelInfo.name,
    color: l.labelInfo.color,
  };
}

// --- Hooks ---

export function useLabels(projectId?: string) {
  const { data, loading, error } = useQuery<{
    listLabels: LabelResponse[];
  }>(LIST_LABELS, {
    variables: { input: { projectId } },
    skip: !projectId,
  });

  return {
    data: data?.listLabels.map(mapLabel),
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useCreateLabel() {
  const [exec, { loading }] = useMutation<{ createLabel: LabelResponse }>(
    CREATE_LABEL,
  );

  return {
    mutate: (
      input: { name: string; color: string; projectId: string },
      opts?: { onSuccess?: (data: Label) => void },
    ) => {
      exec({
        variables: {
          input: {
            name: input.name,
            color: input.color,
            projectId: input.projectId,
          },
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(mapLabel(res.data.createLabel));
      });
    },
    mutateAsync: async (input: {
      name: string;
      color: string;
      projectId: string;
    }): Promise<Label> => {
      const res = await exec({
        variables: {
          input: {
            name: input.name,
            color: input.color,
            projectId: input.projectId,
          },
        },
      });
      return mapLabel(res.data!.createLabel);
    },
    isPending: loading,
  };
}

export function useUpdateLabel() {
  const [exec, { loading }] = useMutation<{ updateLabel: LabelResponse }>(
    UPDATE_LABEL,
  );

  return {
    mutate: (
      vars: { id: string; input: { name?: string; color?: string } },
      opts?: { onSuccess?: (data: Label) => void },
    ) => {
      exec({
        variables: {
          input: {
            id: vars.id,
            name: vars.input.name,
            color: vars.input.color,
          },
        },
      }).then((res) => {
        if (res.data) opts?.onSuccess?.(mapLabel(res.data.updateLabel));
      });
    },
    mutateAsync: async (vars: {
      id: string;
      input: { name?: string; color?: string };
    }): Promise<Label> => {
      const res = await exec({
        variables: {
          input: {
            id: vars.id,
            name: vars.input.name,
            color: vars.input.color,
          },
        },
      });
      return mapLabel(res.data!.updateLabel);
    },
    isPending: loading,
  };
}

export function useDeleteLabel() {
  const [exec, { loading }] = useMutation<{ deleteLabel: boolean }>(
    DELETE_LABEL,
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
