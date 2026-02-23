import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
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
  const result = useQuery<{ listLabels: LabelResponse[] }>(LIST_LABELS, {
    variables: { input: { projectId } },
    skip: !projectId,
  });
  return normalizeQueryResult(result, (d) => d.listLabels.map(mapLabel));
}

export const useCreateLabel = createMutationHook<
  { name: string; color: string; projectId: string },
  LabelResponse,
  Label
>({
  mutation: CREATE_LABEL,
  responseKey: "createLabel",
  mapResponse: mapLabel,
});

export const useUpdateLabel = createMutationHook<
  { id: string; input: { name?: string; color?: string } },
  LabelResponse,
  Label
>({
  mutation: UPDATE_LABEL,
  responseKey: "updateLabel",
  mapVariables: (vars) => ({
    input: { id: vars.id, name: vars.input.name, color: vars.input.color },
  }),
  mapResponse: mapLabel,
});

export const useDeleteLabel = createVoidMutationHook<string>({
  mutation: DELETE_LABEL,
  mapVariables: (id) => ({ input: { id } }),
});
