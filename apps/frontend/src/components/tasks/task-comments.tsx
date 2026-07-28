import { useState, useRef, useEffect } from "react";
import { MessageSquare, Pencil, Trash2, X, Check, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@/hooks/use-users";
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
} from "@/hooks/use-comments";
import { CommentEditor, CommentEditEditor } from "./comment-editor";
import type { CommentEditorHandle } from "./comment-editor";
import { CommentContent } from "./comment-content";
import type { Comment } from "@/types/comment";
import { getInitials } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import styles from "./task-comments.module.css";

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

interface TaskCommentsProps {
  taskId: string;
}

export function TaskComments({ taskId }: TaskCommentsProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [page, setPage] = useState(1);
  const { data: comments = [], pageInfo, isLoading } = useComments(taskId, { page });

  // Reset page when taskId changes
  useEffect(() => { setPage(1); }, [taskId]);

  return (
    <div className={styles.container}>
      <p className={styles.sectionLabel}>
        <MessageSquare className={styles.sectionIcon} />
        Comments
      </p>

      {isLoading ? (
        <div className={styles.loadingRow}>
          <Loader2 className={styles.spinner} />
          Loading comments...
        </div>
      ) : (
        <div className={styles.commentsList}>
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isAuthor={comment.commentInfo.authorId === currentUserId}
              taskId={taskId}
            />
          ))}
        </div>
      )}

      {pageInfo && (pageInfo.hasNextPage || pageInfo.page > 1) && (
        <div className="flex items-center justify-center gap-3 py-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="size-3" />
            Prev
          </button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={!pageInfo.hasNextPage}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight className="size-3" />
          </button>
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
}: {
  comment: Comment;
  isAuthor: boolean;
  taskId: string;
}) {
  const { data: author } = useUser(comment.commentInfo.authorId);
  const authorName = author?.name || comment.commentInfo.authorName || "Unknown user";

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
    <div className={styles.commentRow}>
      <Avatar className={styles.commentAvatar}>
        {author?.avatarUrl && <AvatarImage src={author.avatarUrl} />}
        <AvatarFallback className={styles.avatarFallback}>
          {getInitials(authorName)}
        </AvatarFallback>
      </Avatar>

      <div className={styles.commentBody}>
        <div className={styles.commentHeader}>
          <span className={styles.authorName}>
            {authorName}
          </span>
          <span className={styles.commentTime}>
            {formatRelativeTime(comment.commentInfo.createdAt)}
          </span>
          {isEdited && (
            <span className={styles.editedTag}>
              (edited)
            </span>
          )}

          {isAuthor && !isEditing && (
            <div className={styles.authorActions}>
              <Button
                variant="ghost"
                size="icon"
                className={styles.actionButton}
                onClick={() => setIsEditing(true)}
              >
                <Pencil className={styles.actionIcon} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`${styles.actionButton} ${styles.deleteAction}`}
                onClick={handleDelete}
                disabled={deleteComment.isLoading}
              >
                <Trash2 className={styles.actionIcon} />
              </Button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className={styles.editingContainer}>
            <CommentEditEditor
              initialContent={comment.commentInfo.content}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
            />
            <div className={styles.editActions}>
              <Button
                size="sm"
                className={styles.editButton}
                onClick={() => {
                  /* Ctrl+Enter handles save via editor */
                }}
                disabled={updateComment.isLoading}
              >
                <Check className={styles.editButtonIcon} />
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={styles.editButton}
                onClick={handleCancelEdit}
              >
                <X className={styles.editButtonIcon} />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.contentArea}>
            <CommentContent content={comment.commentInfo.content} />
          </div>
        )}
      </div>
    </div>
  );
}

export function AddCommentForm({ taskId }: { taskId: string }) {
  const createComment = useCreateComment();
  const editorRef = useRef<CommentEditorHandle>(null);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: currentUser } = useUser(currentUserId);
  const displayName = currentUser?.name ?? "You";

  const handleSubmit = (html: string, mentionedUserIds: string[]) => {
    createComment.mutate({ taskId, content: html, mentionedUserIds });
  };

  return (
    <div className={styles.addCommentFormWrapper}>
      <div className={styles.addCommentRow}>
        <Avatar className={styles.addCommentAvatar}>
          {currentUser?.avatarUrl && <AvatarImage src={currentUser.avatarUrl} />}
          <AvatarFallback className={styles.avatarFallback}>
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className={styles.addCommentEditorArea}>
          <CommentEditor
            ref={editorRef}
            onSubmit={handleSubmit}
            placeholder="Write a comment..."
          />
        </div>
        <Button
          variant="secondary"
          className={styles.sendButton}
          onClick={() => editorRef.current?.submit()}
          disabled={createComment.isLoading}
        >
          {createComment.isLoading ? (
            <Loader2 className={styles.sendIcon} />
          ) : (
            <>Send</>
          )}
        </Button>
      </div>
    </div>
  );
}
