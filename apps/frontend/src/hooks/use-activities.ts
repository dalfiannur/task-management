import { useQuery } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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
  return useQuery({
    queryKey: ["activities", taskId],
    queryFn: async (): Promise<Activity[]> => {
      const data = await graphqlClient.request<{
        listActivities: Activity[];
      }>(LIST_ACTIVITIES, { input: { taskId } });
      return data.listActivities;
    },
    enabled: !!taskId,
  });
}
