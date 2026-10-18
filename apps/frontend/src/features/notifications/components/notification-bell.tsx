import { useNavigate } from "@tanstack/react-router";
import { AutomationTag } from "@/components/shared/automation-tag";
import { formatDistanceToNow, parseISO } from "date-fns";
import { CheckCheck } from "lucide-react";
import { Button, NotificationButton, Popover, PopoverContent, PopoverTrigger } from "sedjiwa-ui";
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
    if (!n.projectId) return;
    if (n.taskId) {
      navigate({
        to: "/projects/$projectId/all-tasks",
        params: { projectId: n.projectId },
        search: { task: n.taskId, comment: n.commentId },
      });
    } else {
      // No task on this notification (e.g. member-added) — land on the
      // project itself. Rute telanjang, biar tab default ditentukan di satu
      // tempat (index.tsx), bukan diulang di sini.
      navigate({
        to: "/projects/$projectId",
        params: { projectId: n.projectId },
      });
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <NotificationButton
          count={count}
          max={99}
          label="Notifications"
          countLabel={(n) => `${n} unread`}
        />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
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
            <li className="p-4 text-sm text-muted-foreground">Loading…</li>
          ) : notifications.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">
              No notifications.
            </li>
          ) : (
            notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onClick(n)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left transition-colors [transition-duration:var(--duration-fast)] last:border-b-0 hover:bg-accent",
                    !n.read && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{n.message}</span>
                    {n.automationId && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        via <AutomationTag name={n.automationName ?? ""} />
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
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
