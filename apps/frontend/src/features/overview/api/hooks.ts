// Project Overview read hook (connect-query). Read-only — the tab has no writes.

import { useQuery } from "@connectrpc/connect-query";
import { useMemo } from "react";
import { DashboardService } from "@/lib/gen/dashboard_pb";
import type { ProjectOverview } from "../types";
import { mapOverview } from "./mappers";

/** `overview` is memoized on the query data: a fresh `mapOverview()` call on
 *  every render would hand out fresh `perModule`/`memberIds` arrays too, and
 *  the churn from that is silent (see `useProjectMembers` in
 *  `features/projects/api/hooks.ts` for the same hazard). */
export function useProjectOverview(projectId: string) {
  const result = useQuery(
    DashboardService.method.getProjectOverview,
    { projectId },
    { enabled: !!projectId },
  );
  const overview: ProjectOverview | null = useMemo(
    () => (result.data ? mapOverview(result.data) : null),
    [result.data],
  );
  return { ...result, overview };
}
