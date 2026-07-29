// Dashboard + my-tasks read hooks (connect-query). Cross-project aggregation,
// scoped to the caller's member projects (admin = all).

import { useQuery } from "@connectrpc/connect-query";
import { DashboardService, MyTasksService } from "@/lib/gen/dashboard_pb";
import {
  statusToProto,
  priorityToProto,
  type TaskPriority,
  type TaskStatus,
} from "@/features/tasks";
import type { DashboardStats, MyTaskItem, MyTasksView } from "../types";
import { mapStats, mapMyTasks } from "./mappers";

export function useDashboardStats() {
  const result = useQuery(DashboardService.method.getDashboardStats, {});
  const stats: DashboardStats | null = result.data
    ? mapStats(result.data)
    : null;
  return { ...result, stats };
}

export function useUpcomingDeadlines(withinDays = 7) {
  const result = useQuery(DashboardService.method.getUpcomingDeadlines, {
    withinDays,
  });
  const items: MyTaskItem[] = mapMyTasks(result.data?.items ?? []);
  return { ...result, items };
}

const VIEW_METHOD = {
  assigned: MyTasksService.method.listAssignedToMe,
  created: MyTasksService.method.listCreatedByMe,
  involving: MyTasksService.method.listInvolvingMe,
} as const;

export interface MyTasksFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  page?: number;
}

export function useMyTasks(
  view: MyTasksView,
  { status, priority, page = 1 }: MyTasksFilter = {},
) {
  const result = useQuery(VIEW_METHOD[view], {
    status: status ? statusToProto(status) : undefined,
    priority: priority ? priorityToProto(priority) : undefined,
    page,
    pageSize: 20,
  });
  const items: MyTaskItem[] = mapMyTasks(result.data?.items ?? []);
  return { ...result, items, total: result.data?.total ?? 0 };
}
