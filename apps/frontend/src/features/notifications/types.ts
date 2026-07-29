// Flat FE type for the notifications domain, mapped from gen/notifications_pb.

export type NotificationKind =
  | "mention"
  | "task_assigned"
  | "project_member_added"
  | "ownership_transferred"
  | "account_approved"
  | "other";

export interface Notification {
  id: string;
  kind: NotificationKind;
  actorId: string;
  message: string;
  read: boolean;
  createdAt: string;
  projectId?: string;
  taskId?: string;
  commentId?: string;
}
