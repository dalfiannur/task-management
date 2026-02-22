import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: async (): Promise<Notification[]> => {
      const data = await graphqlClient.request<{
        listNotifications: Notification[];
      }>(LIST_NOTIFICATIONS, { input: { limit } });
      return data.listNotifications;
    },
  });
}

export function useUnreadNotificationCount() {
  const prevCountRef = useRef<number | null>(null);

  const query = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async (): Promise<number> => {
      const data = await graphqlClient.request<{
        unreadNotificationCount: number;
      }>(UNREAD_COUNT, { input: {} });
      return data.unreadNotificationCount;
    },
    refetchInterval: 30_000,
  });

  // Toast on count increase
  useEffect(() => {
    if (query.data === undefined) return;
    const count = query.data;
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
  }, [query.data]);

  return query;
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<boolean> => {
      const data = await graphqlClient.request<{
        markNotificationsRead: boolean;
      }>(MARK_READ, { input: { ids } });
      return data.markNotificationsRead;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<boolean> => {
      const data = await graphqlClient.request<{
        markAllNotificationsRead: boolean;
      }>(MARK_ALL_READ, { input: {} });
      return data.markAllNotificationsRead;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
