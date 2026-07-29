import type { Notification as PbNotification } from "@/lib/gen/notifications_pb";
import { NotificationType } from "@/lib/gen/notifications_pb";
import type { Notification, NotificationKind } from "../types";

function mapKind(t: NotificationType): NotificationKind {
  switch (t) {
    case NotificationType.MENTION:
      return "mention";
    case NotificationType.TASK_ASSIGNED:
      return "task_assigned";
    case NotificationType.PROJECT_MEMBER_ADDED:
      return "project_member_added";
    case NotificationType.OWNERSHIP_TRANSFERRED:
      return "ownership_transferred";
    case NotificationType.ACCOUNT_APPROVED:
      return "account_approved";
    default:
      return "other";
  }
}

export function mapNotification(n: PbNotification): Notification {
  return {
    id: n.id,
    kind: mapKind(n.type),
    actorId: n.actorId,
    message: n.message,
    read: n.read,
    createdAt: n.createdAt,
    projectId: n.projectId,
    taskId: n.taskId,
    commentId: n.commentId,
  };
}
