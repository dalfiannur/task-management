import { useState } from "react";
import { Bell, CheckCheck, ChevronLeft, ChevronRight, MessageSquare, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationsRead,
  useMarkAllNotificationsRead,
} from "@/hooks/use-notifications";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types/notification";

function formatTimeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const { data: count = 0 } = useUnreadNotificationCount();
  const { data: notifications = [], pageInfo, isLoading } = useNotifications({ page });
  const markRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  const handleNotificationClick = (notification: Notification) => {
    if (notification.notificationInfo.read === "false") {
      markRead.mutate([notification.id]);
    }
    setOpen(false);
    navigate(`/projects?search=${encodeURIComponent(notification.notificationInfo.taskTitle)}`);
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-medium">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">Notifications</span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isLoading}
            >
              <CheckCheck className="size-3" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="size-8 mb-2 opacity-20" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onClick={() => handleNotificationClick(n)}
              />
            ))
          )}
        </div>

        {pageInfo && (pageInfo.hasNextPage || pageInfo.page > 1) && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">Page {page}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!pageInfo.hasNextPage}
              onClick={() => setPage(page + 1)}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: Notification;
  onClick: () => void;
}) {
  const info = notification.notificationInfo;
  const isUnread = info.read === "false";

  const Icon = info.type === "mention" ? MessageSquare : UserPlus;

  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        isUnread && "bg-accent/30"
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "mt-0.5 flex items-center justify-center size-7 rounded-full shrink-0",
          info.type === "mention"
            ? "bg-blue-900/30 text-blue-400"
            : "bg-green-900/30 text-green-400"
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug break-words whitespace-normal">
          {info.message}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          {formatTimeAgo(info.createdAt)}
        </p>
      </div>
      {isUnread && (
        <div className="mt-2 size-2 rounded-full bg-primary shrink-0" />
      )}
    </button>
  );
}
