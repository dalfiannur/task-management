// Labels palette RPC hooks (connect-query over LabelService). Member-gated CRUD.
// Deleting a label also affects task label chips, so invalidate tasks too.

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { LabelService } from "@/lib/gen/labels_pb";
import { TaskService } from "@/lib/gen/work_pb";
import { queryClient } from "@/lib/query";
import type { Label } from "../types";
import { mapLabel } from "./mappers";

function invalidateLabels() {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({
        schema: LabelService,
        cardinality: "finite",
      }),
    }),
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({
        schema: TaskService,
        cardinality: "finite",
      }),
    }),
  ]);
}

export function useLabels(projectId: string) {
  const result = useQuery(
    LabelService.method.listLabels,
    { projectId },
    { enabled: !!projectId },
  );
  const labels: Label[] = (result.data?.labels ?? []).map(mapLabel);
  return { ...result, labels };
}

/** id → Label map for resolving task label chips. */
export function useLabelMap(projectId: string): Record<string, Label> {
  const { labels } = useLabels(projectId);
  return useMemo(() => {
    const map: Record<string, Label> = {};
    for (const l of labels) map[l.id] = l;
    return map;
  }, [labels]);
}

export function useCreateLabel() {
  return useMutation(LabelService.method.createLabel, {
    onSuccess: invalidateLabels,
  });
}
export function useUpdateLabel() {
  return useMutation(LabelService.method.updateLabel, {
    onSuccess: invalidateLabels,
  });
}
export function useDeleteLabel() {
  return useMutation(LabelService.method.deleteLabel, {
    onSuccess: invalidateLabels,
  });
}
