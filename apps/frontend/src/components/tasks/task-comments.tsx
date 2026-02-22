import { useState } from "react";
import { useAuth } from "react-oidc-context";
import { MessageSquare, Pencil, Trash2, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUsers } from "@/hooks/use-users";
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
} from "@/hooks/use-comments";
import { CommentEditor, CommentEditEditor } from "./comment-editor";
import { CommentContent } from "./comment-content";
import type { Comment } from "@/types/comment";

export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface TaskCommentsProps {
  taskId: string;
}

export function TaskComments({ taskId }: TaskCommentsProps) {
  const auth = useAuth();
  const currentUserId = auth.user?.profile?.sub as string | undefined;
  const { data: comments = [], isLoading } = useComments(taskId);
  const { data: users = [] } = useUsers();

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
        <MessageSquare className="size-3.5" />
        Comments ({comments.length})
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="size-3.5 animate-spin" />
          Loading comments...
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isAuthor={comment.commentInfo.authorId === currentUserId}
              taskId={taskId}
              users={users}
            />
          ))}
        </div>
      )}

      <AddCommentForm taskId={taskId} />
    </div>
  );
}

export function CommentItem({
  comment,
  isAuthor,
  taskId,
  users,
}: {
  comment: Comment;
  isAuthor: boolean;
  taskId: string;
  users: Array<{ id: string; name: string; avatarUrl?: string }>;
}) {
  const author = users.find((u) => u.id === comment.commentInfo.authorId);
  const authorName = author?.name || comment.commentInfo.authorName || "Unknown";

  const [isEditing, setIsEditing] = useState(false);
  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();

  const isEdited = comment.commentInfo.updatedAt !== comment.commentInfo.createdAt;

  const handleSaveEdit = (html: string, mentionedUserIds: string[]) => {
    updateComment.mutate(
      { id: comment.id, content: html, taskId, mentionedUserIds },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleDelete = () => {
    deleteComment.mutate({ id: comment.id, taskId });
  };

  return (
    <div className="group flex gap-2.5">
      <Avatar className="size-7 shrink-0 mt-0.5">
        {author?.avatarUrl && <AvatarImage src={author.avatarUrl} />}
        <AvatarFallback className="text-[10px] bg-muted">
          {getInitials(authorName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {authorName}
          </span>
          <span className="text-[11px] text-muted-foreground/60">
            {formatRelativeTime(comment.commentInfo.createdAt)}
          </span>
          {isEdited && (
            <span className="text-[10px] text-muted-foreground/40 italic">
              (edited)
            </span>
          )}

          {isAuthor && !isEditing && (
            <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteComment.isPending}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="mt-1.5 space-y-2">
            <CommentEditEditor
              initialContent={comment.commentInfo.content}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
            />
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  /* Ctrl+Enter handles save via editor */
                }}
                disabled={updateComment.isPending}
              >
                <Check className="size-3 mr-1" />
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={handleCancelEdit}
              >
                <X className="size-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5">
            <CommentContent content={comment.commentInfo.content} />
          </div>
        )}
      </div>
    </div>
  );
}

export function AddCommentForm({ taskId }: { taskId: string }) {
  const createComment = useCreateComment();

  const handleSubmit = (html: string, mentionedUserIds: string[]) => {
    createComment.mutate({ taskId, content: html, mentionedUserIds });
  };

  return (
    <div className="space-y-2 pt-1">
      <CommentEditor
        onSubmit={handleSubmit}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/40">
          Ctrl+Enter to submit &middot; Type @ to mention
        </span>
        <span className="text-[10px] text-muted-foreground/40">
          {createComment.isPending && (
            <Loader2 className="size-3 animate-spin inline mr-1" />
          )}
        </span>
      </div>
    </div>
  );
}
