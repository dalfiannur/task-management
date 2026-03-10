import { useState } from "react";
import { Bell, CheckCheck, MessageSquare, UserPlus } from "lucide-react";
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
import styles from "./notification-bell.module.css";

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
  const { data: count = 0 } = useUnreadNotificationCount();
  const { data: notifications = [], isLoading } = useNotifications();
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
        <Button variant="ghost" size="icon" className={styles.bellBtn}>
          <Bell className={styles.bellIcon} />
          {count > 0 && (
            <span className={styles.badge}>
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={styles.popoverContent}
        align="end"
        sideOffset={8}
      >
        <div className={styles.popoverHeader}>
          <span className={styles.popoverTitle}>Notifications</span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.markAllBtn}
              onClick={handleMarkAllRead}
              disabled={markAllRead.isLoading}
            >
              <CheckCheck className={styles.markAllIcon} />
              Mark all read
            </Button>
          )}
        </div>

        <div className={styles.notifList}>
          {isLoading ? (
            <div className={styles.loadingState}>Loading...</div>
          ) : notifications.length === 0 ? (
            <div className={styles.emptyState}>
              <Bell className={styles.emptyIcon} />
              <p className={styles.emptyText}>No notifications yet</p>
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
    <Button
      variant="ghost"
      type="button"
      className={cn(styles.notifItem, isUnread && styles.notifItemUnread)}
      onClick={onClick}
    >
      <div className={info.type === "mention" ? styles.notifIconMention : styles.notifIconAssignment}>
        <Icon className={styles.notifIconSvg} />
      </div>
      <div className={styles.notifBody}>
        <p className={styles.notifMessage}>{info.message}</p>
        <p className={styles.notifTime}>{formatTimeAgo(info.createdAt)}</p>
      </div>
      {isUnread && <div className={styles.unreadDot} />}
    </Button>
  );
}
