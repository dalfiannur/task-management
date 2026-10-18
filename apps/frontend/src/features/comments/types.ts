// Flat FE type for the comments domain, mapped from gen/comments_pb.

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Set when an automation rule posted it; `automationName` "" once deleted. */
  automationId?: string;
  automationName?: string;
}
