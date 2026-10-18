// Workload RPC hooks (connect-query over WorkloadService).
//
// The workload is derived from tasks and time entries that other features
// write, so it is never served from cache: every mount refetches.

import { useMemo } from "react";
import { format } from "date-fns";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
import { WorkloadService } from "@/lib/gen/workload_pb";
import { queryClient } from "@/lib/query";
import type { CalendarScope } from "../types";
import { mapCalendar, mapWorkload, scopeToProto } from "./mappers";

export const DEFAULT_WEEKS = 6;

export function useWorkload(projectId?: string, weeks = DEFAULT_WEEKS) {
  const today = format(new Date(), "yyyy-MM-dd");
  const result = useQuery(
    WorkloadService.method.getWorkload,
    { projectId, today, weeks },
    { staleTime: 0 },
  );
  const workload = useMemo(
    () => (result.data ? mapWorkload(result.data) : undefined),
    [result.data],
  );
  return { ...result, workload };
}

export function useWorkCalendar(scope: CalendarScope, id = "", enabled = true) {
  const result = useQuery(
    WorkloadService.method.getWorkCalendar,
    { scope: scopeToProto(scope), id },
    { enabled },
  );
  const calendar = useMemo(
    () => (result.data ? mapCalendar(result.data) : undefined),
    [result.data],
  );
  return { ...result, calendar };
}

export function useSetWorkCalendar() {
  return useMutation(WorkloadService.method.setWorkCalendar, {
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({ schema: WorkloadService, cardinality: "finite" }),
      }),
  });
}
