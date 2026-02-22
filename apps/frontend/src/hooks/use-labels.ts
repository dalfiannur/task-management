import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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
  return useQuery({
    queryKey: ["labels", { projectId }],
    queryFn: async (): Promise<Label[]> => {
      if (!projectId) return [];
      const data = await graphqlClient.request<{
        listLabels: LabelResponse[];
      }>(LIST_LABELS, { input: { projectId } });
      return data.listLabels.map(mapLabel);
    },
    enabled: !!projectId,
  });
}

export function useCreateLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      color: string;
      projectId: string;
    }): Promise<Label> => {
      const data = await graphqlClient.request<{
        createLabel: LabelResponse;
      }>(CREATE_LABEL, {
        input: {
          name: input.name,
          color: input.color,
          projectId: input.projectId,
        },
      });
      return mapLabel(data.createLabel);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}

export function useUpdateLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: { name?: string; color?: string };
    }): Promise<Label> => {
      const data = await graphqlClient.request<{
        updateLabel: LabelResponse;
      }>(UPDATE_LABEL, {
        input: {
          id,
          name: input.name,
          color: input.color,
        },
      });
      return mapLabel(data.updateLabel);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}

export function useDeleteLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await graphqlClient.request<{ deleteLabel: boolean }>(DELETE_LABEL, {
        input: { id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}
