import { useQuery, gql } from "@/lib/graphql-client";
import { normalizeQueryResult } from "@/lib/hook-factories";

const GET_DASHBOARD_STATS = gql`
  query GetDashboardStats($input: getDashboardStatsInput!) {
    getDashboardStats(input: $input)
  }
`;

interface DashboardStats {
  totalTasks: number;
  inProgressTasks: number;
  doneTasks: number;
}

export function useDashboardStats(coreProjectIds: string[]) {
  const result = useQuery<{ getDashboardStats: DashboardStats }>(
    GET_DASHBOARD_STATS,
    {
      variables: { input: { coreProjectIds } },
      skip: coreProjectIds.length === 0,
    },
  );
  return normalizeQueryResult(result, (d) => d.getDashboardStats);
}
