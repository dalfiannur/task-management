// Automation RPC hooks (connect-query over AutomationService). Saving or
// toggling a rule refreshes the rules; runs refetch on mount.

import { useMemo } from "react";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
import { AutomationService } from "@/lib/gen/automations_pb";
import { queryClient } from "@/lib/query";
import { mapAutomation, mapRun } from "./mappers";

const refresh = () =>
  queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({ schema: AutomationService, cardinality: "finite" }),
  });

export function useAutomations(projectId: string) {
  const result = useQuery(
    AutomationService.method.listAutomations,
    { projectId },
    { enabled: !!projectId },
  );
  const automations = useMemo(
    () => (result.data?.automations ?? []).map(mapAutomation),
    [result.data],
  );
  return { ...result, automations };
}

export function useAutomationRuns(projectId: string, limit = 50) {
  const result = useQuery(
    AutomationService.method.listAutomationRuns,
    { projectId, limit },
    { enabled: !!projectId, staleTime: 0 },
  );
  const runs = useMemo(() => (result.data?.runs ?? []).map(mapRun), [result.data]);
  return { ...result, runs };
}

export function useCreateAutomation() {
  return useMutation(AutomationService.method.createAutomation, { onSuccess: refresh });
}

export function useUpdateAutomation() {
  return useMutation(AutomationService.method.updateAutomation, { onSuccess: refresh });
}

export function useDeleteAutomation() {
  return useMutation(AutomationService.method.deleteAutomation, { onSuccess: refresh });
}

export function useSetAutomationMode() {
  return useMutation(AutomationService.method.setAutomationMode, { onSuccess: refresh });
}
