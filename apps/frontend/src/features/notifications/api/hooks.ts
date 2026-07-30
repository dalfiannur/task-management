// Notifications: unary list/unread/mark via connect-query, plus a live
// server-stream opened with the RAW Connect client (connect-query can't do
// streaming). New stream events kick a refetch of the unary queries.

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
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
 * the unary queries on each event. Resilient — reconnects with exponential
 * backoff if the stream drops, and re-opens when the tab becomes visible. The
 * request stays "pending" in the network tab for its whole lifetime (that's
 * how server-streaming looks); the 30s unread poll is the correctness safety net.
 */
export function useNotificationStream() {
  useEffect(() => {
    let stopped = false;
    let connected = false;
    let retry = 0;
    let ac: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (stopped || connected || document.hidden) return;
      connected = true;
      ac = new AbortController();
      try {
        const stream = client(NotificationService).streamNotifications(
          {},
          { signal: ac.signal },
        );
        for await (const _event of stream) {
          retry = 0; // a delivered event means the connection is healthy
          void invalidateNotifications();
        }
        // Server closed the stream cleanly → try to re-establish.
        connected = false;
        scheduleReconnect();
      } catch {
        connected = false;
        // Aborted by unmount/visibility handling is intentional — don't loop here.
        if (ac?.signal.aborted) return;
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (stopped || document.hidden || timer) return;
      const delay = Math.min(30_000, 1_000 * 2 ** retry);
      retry += 1;
      timer = setTimeout(() => {
        timer = null;
        void connect();
      }, delay);
    }

    function onVisibility() {
      if (document.hidden || stopped) return;
      // Back in focus: cancel any backoff wait and ensure we're connected.
      retry = 0;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!connected) void connect();
    }

    document.addEventListener("visibilitychange", onVisibility);
    void connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
      ac?.abort();
    };
  }, []);
}
