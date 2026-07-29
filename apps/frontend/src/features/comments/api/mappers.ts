import type { Comment as PbComment } from "@/lib/gen/comments_pb";
import type { Comment } from "../types";

export function mapComment(c: PbComment): Comment {
  return {
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId,
    content: c.content,
    mentionedUserIds: c.mentionedUserIds,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
