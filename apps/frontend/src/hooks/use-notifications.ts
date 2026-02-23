import { useEffect, useRef } from "react";
import { useQuery, gql } from "@/lib/graphql-client";
import { createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import { toast } from "sonner";
import type { Notification } from "@/types/notification";

const NOTIFICATION_FIELDS = gql`
  fragment NotificationFields on Notification {
    id
    notificationInfo {
      recipientId
      type
      actorId
      actorName
      taskId
      taskTitle
      commentId
      message
      read
      createdAt
    }
  }
`;

const LIST_NOTIFICATIONS = gql`
  ${NOTIFICATION_FIELDS}
  query ListNotifications($input: listNotificationsInput!) {
    listNotifications(input: $input) {
      ...NotificationFields
    }
  }
`;

const UNREAD_COUNT = gql`
  query UnreadNotificationCount($input: unreadNotificationCountInput!) {
    unreadNotificationCount(input: $input)
  }
`;

const MARK_READ = gql`
  mutation MarkNotificationsRead($input: markNotificationsReadInput!) {
    markNotificationsRead(input: $input)
  }
`;

const MARK_ALL_READ = gql`
  mutation MarkAllNotificationsRead($input: markAllNotificationsReadInput!) {
    markAllNotificationsRead(input: $input)
  }
`;

export function useNotifications(limit = 50) {
  const result = useQuery<{ listNotifications: Notification[] }>(
    LIST_NOTIFICATIONS,
    { variables: { input: { limit } } },
  );
  return normalizeQueryResult(result, (d) => d.listNotifications);
}

export function useUnreadNotificationCount() {
  const prevCountRef = useRef<number | null>(null);

  const { data, loading, error } = useQuery<{
    unreadNotificationCount: number;
  }>(UNREAD_COUNT, {
    variables: { input: {} },
    pollInterval: 30_000,
  });

  const count = data?.unreadNotificationCount;

  // Toast on count increase
  useEffect(() => {
    if (count === undefined) return;
    const prev = prevCountRef.current;

    if (prev !== null && count > prev) {
      const diff = count - prev;
      toast.info(
        diff === 1
          ? "You have a new notification"
          : `You have ${diff} new notifications`,
      );
    }
    prevCountRef.current = count;
  }, [count]);

  return {
    data: count,
    isLoading: loading,
    error: error ?? null,
  };
}

export const useMarkNotificationsRead = createVoidMutationHook<string[]>({
  mutation: MARK_READ,
  mapVariables: (ids) => ({ input: { ids } }),
});

export const useMarkAllNotificationsRead = createVoidMutationHook<void>({
  mutation: MARK_ALL_READ,
  mapVariables: () => ({ input: {} }),
});
