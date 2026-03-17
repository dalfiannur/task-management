import { useEffect, useRef } from "react";
import { useQuery, gql } from "@/lib/graphql-client";
import { createVoidMutationHook, normalizeQueryResult, type PageInfo } from "@/lib/hook-factories";
import { toast } from "sonner";
import type { Notification } from "@/types/notification";

const LIST_NOTIFICATIONS = gql`
  query ListNotifications($input: listNotificationsInput!) {
    listNotifications(input: $input)
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

interface PaginatedNotifications {
  items: Notification[];
  pageInfo: PageInfo;
}

export function useNotifications(opts?: { page?: number; pageSize?: number }) {
  const result = useQuery<{ listNotifications: PaginatedNotifications }>(
    LIST_NOTIFICATIONS,
    { variables: { input: { page: opts?.page, pageSize: opts?.pageSize } } },
  );
  const normalized = normalizeQueryResult(result, (d) => ({
    notifications: d.listNotifications.items,
    pageInfo: d.listNotifications.pageInfo,
  }));
  return {
    data: normalized.data?.notifications,
    pageInfo: normalized.data?.pageInfo ?? null,
    isLoading: normalized.isLoading,
    error: normalized.error,
  };
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
  refetchQueries: [LIST_NOTIFICATIONS, UNREAD_COUNT],
});

export const useMarkAllNotificationsRead = createVoidMutationHook<void>({
  mutation: MARK_ALL_READ,
  mapVariables: () => ({ input: {} }),
  refetchQueries: [LIST_NOTIFICATIONS, UNREAD_COUNT],
});
