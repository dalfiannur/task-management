export type NotificationType = "mention" | "task_assigned";

export interface Notification {
  id: string;
  notificationInfo: {
    recipientId: string;
    type: NotificationType;
    actorId: string;
    actorName: string;
    taskId: string;
    taskTitle: string;
    commentId: string;
    message: string;
    read: string;
    createdAt: string;
  };
}
