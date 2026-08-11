import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Notification } from "../types";
import {
  useNotifications,
  useUnreadCount,
  useMarkRead,
  useMarkAllRead,
  useNotificationStream,
} from "../api/hooks";

function relative(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function NotificationBell() {
  const navigate = useNavigate();
  const { count } = useUnreadCount();
  const { notifications, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  useNotificationStream();

  function onClick(n: Notification) {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    if (n.projectId) {
      navigate({
        to: "/projects/$projectId/all-tasks",
        params: { projectId: n.projectId },
      });
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-text-on-danger">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAll.mutate({})}
              disabled={markAll.isPending}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <li className="p-4 text-sm text-text-muted">Loading…</li>
          ) : notifications.length === 0 ? (
            <li className="p-6 text-center text-sm text-text-muted">
              No notifications.
            </li>
          ) : (
            notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onClick(n)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-border-subtle px-3 py-2.5 text-left transition-colors [transition-duration:var(--duration-fast)] last:border-b-0 hover:bg-surface-hover",
                    !n.read && "bg-brand/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-brand",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{n.message}</span>
                    <span className="block text-xs text-text-muted">
                      {relative(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
