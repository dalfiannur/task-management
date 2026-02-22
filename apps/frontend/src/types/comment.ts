export interface Comment {
  id: string;
  commentInfo: {
    taskId: string;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    mentionedUserIds?: string;
  };
}
