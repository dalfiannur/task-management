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
