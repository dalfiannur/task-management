// Project Overview read hook (connect-query). Read-only — the tab has no writes.

import { useQuery } from "@connectrpc/connect-query";
import { DashboardService } from "@/lib/gen/dashboard_pb";
import type { ProjectOverview } from "../types";
import { mapOverview } from "./mappers";

export function useProjectOverview(projectId: string) {
  const result = useQuery(
    DashboardService.method.getProjectOverview,
    { projectId },
    { enabled: !!projectId },
  );
  const overview: ProjectOverview | null = result.data
    ? mapOverview(result.data)
    : null;
  return { ...result, overview };
}
