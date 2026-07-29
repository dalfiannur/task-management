// Activity (audit log) read hooks (connect-query over ActivityService).
// Read-only — no mutations, no invalidation.

import { useQuery } from "@connectrpc/connect-query";
import { ActivityService } from "@/lib/gen/activity_pb";
import type { Activity } from "../types";
import { mapActivity } from "./mappers";

/** Activity within one project (member-gated). */
export function useProjectActivity(projectId: string, pageSize = 30) {
  const result = useQuery(
    ActivityService.method.listProjectActivity,
    { projectId, page: 1, pageSize },
    { enabled: !!projectId },
  );
  const activities: Activity[] = (result.data?.activities ?? []).map(mapActivity);
  return { ...result, activities, total: result.data?.total ?? 0 };
}

/** Recent activity across the caller's member projects (admin = all). */
export function useRecentActivity(pageSize = 30) {
  const result = useQuery(ActivityService.method.listRecentActivity, {
    page: 1,
    pageSize,
  });
  const activities: Activity[] = (result.data?.activities ?? []).map(mapActivity);
  return { ...result, activities, total: result.data?.total ?? 0 };
}
