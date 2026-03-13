import { useQuery, gql } from "@/lib/graphql-client";
import type { Activity } from "@/types/activity";

const ACTIVITY_FIELDS = gql`
  fragment ActivityFields on Activity {
    id
    activityInfo {
      taskId
      actorId
      actorName
      action
      taskTitle
      changes
      createdAt
    }
  }
`;

const LIST_ACTIVITIES = gql`
  ${ACTIVITY_FIELDS}
  query ListActivities($input: listActivitiesInput!) {
    listActivities(input: $input) {
      ...ActivityFields
    }
  }
`;

const LIST_RECENT_ACTIVITIES = gql`
  ${ACTIVITY_FIELDS}
  query ListRecentActivities($input: listRecentActivitiesInput!) {
    listRecentActivities(input: $input) {
      ...ActivityFields
    }
  }
`;

export function useActivities(taskId: string) {
  const { data, loading, error } = useQuery<{
    listActivities: Activity[];
  }>(LIST_ACTIVITIES, {
    variables: { input: { taskId } },
    skip: !taskId,
  });

  return {
    data: data?.listActivities,
    isLoading: loading,
    error: error ?? null,
  };
}

export function useRecentActivities(limit = 20, coreProjectIds?: string[]) {
  const { data, loading, error } = useQuery<{
    listRecentActivities: Activity[];
  }>(LIST_RECENT_ACTIVITIES, {
    variables: { input: { limit, coreProjectIds } },
    pollInterval: 30000,
    skip: coreProjectIds !== undefined && coreProjectIds.length === 0,
  });

  return {
    data: data?.listRecentActivities,
    isLoading: loading,
    error: error ?? null,
  };
}
