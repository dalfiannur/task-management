// Notifications: unary list/unread/mark via connect-query, plus a live
// server-stream opened with the RAW Connect client (connect-query can't do
// streaming). New stream events kick a refetch of the unary queries.

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { ConnectError, Code } from "@connectrpc/connect";
import { NotificationService } from "@/lib/gen/notifications_pb";
import { client } from "@/lib/connect";
import { queryClient } from "@/lib/query";
import type { Notification } from "../types";
import { mapNotification } from "./mappers";

function invalidateNotifications() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: NotificationService,
      cardinality: "finite",
    }),
  });
}

export function useNotifications(pageSize = 20) {
  const result = useQuery(NotificationService.method.listNotifications, {
    page: 1,
    pageSize,
  });
  const notifications: Notification[] = (result.data?.notifications ?? []).map(
    mapNotification,
  );
  return { ...result, notifications, total: result.data?.total ?? 0 };
}

export function useUnreadCount() {
  const result = useQuery(
    NotificationService.method.unreadCount,
    {},
    { refetchInterval: 30_000 },
  );
  return { ...result, count: result.data?.count ?? 0 };
}

export function useMarkRead() {
  return useMutation(NotificationService.method.markRead, {
    onSuccess: invalidateNotifications,
  });
}

export function useMarkAllRead() {
  return useMutation(NotificationService.method.markAllRead, {
    onSuccess: invalidateNotifications,
  });
}

/**
 * Live push: opens the server-stream via the raw Connect client and refetches
 * the unary queries on each event. Reconnect is left to the query polling
 * fallback; a clean unmount aborts the stream.
 */
export function useNotificationStream() {
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const stream = client(NotificationService).streamNotifications(
          {},
          { signal: ac.signal },
        );
        for await (const _event of stream) {
          void invalidateNotifications();
        }
      } catch (err) {
        // Abort on unmount is expected; ignore. Other errors → polling covers it.
        if (err instanceof ConnectError && err.code === Code.Canceled) return;
      }
    })();
    return () => ac.abort();
  }, []);
}
