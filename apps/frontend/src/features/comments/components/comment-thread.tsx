import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, getInitials } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useProjectMembers } from "@/features/projects";
import { useUserMap } from "@/features/users";
import type { Comment } from "../types";
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
} from "../api/hooks";
import { RichTextContent } from "@/components/shared/rich-text-content";
import { CommentComposer } from "./comment-composer";

function relative(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

/** Task comment thread + composer. Mounted in the task dialog (edit mode). */
export function CommentThread({
  taskId,
  projectId,
  highlightCommentId,
}: {
  taskId: string;
  projectId: string;
  /** Deep-linked comment id: scrolled into view and marked once loaded. */
  highlightCommentId?: string;
}) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { comments, isLoading } = useComments(taskId);
  const { memberIds, ownerId } = useProjectMembers(projectId);
  const userMap = useUserMap();
  const create = useCreateComment();
  const update = useUpdateComment();
  const del = useDeleteComment();
  const [editingId, setEditingId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLLIElement | null>(null);

  const canModerate = isAdmin || ownerId === me?.id;

  // Runs once the matching <li> exists — i.e. after `comments` loads — not
  // on every render, since the ref is only attached post-render.
  useEffect(() => {
    if (!highlightCommentId) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightCommentId, comments]);

  function add(content: string, mentionIds: string[]) {
    create.mutate(
      { taskId, content, mentionedUserIds: mentionIds },
      { onError: (e) => toast.error(e.message || "Failed to comment") },
    );
  }

  function saveEdit(c: Comment, content: string, mentionIds: string[]) {
    update.mutate(
      { id: c.id, content, mentionedUserIds: mentionIds },
      {
        onSuccess: () => setEditingId(null),
        onError: (e) => toast.error(e.message || "Failed to update"),
      },
    );
  }

  function remove(c: Comment) {
    del.mutate(
      { id: c.id },
      {
        onSuccess: () => toast.success("Comment deleted."),
        onError: (e) => toast.error(e.message || "Failed to delete"),
      },
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium">
        Comments{" "}
        {comments.length > 0 && (
          <span className="text-num text-text-muted">({comments.length})</span>
        )}
      </h4>

      {isLoading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => {
            const author = userMap[c.authorId];
            const name = author?.displayName ?? c.authorId;
            const mine = c.authorId === me?.id;
            const highlighted = c.id === highlightCommentId;
            return (
              <li
                key={c.id}
                ref={highlighted ? highlightRef : undefined}
                className={cn(
                  "flex gap-3 rounded-lg transition-colors [transition-duration:var(--duration-slow)]",
                  // A neutral fill (--surface-hover), not a brand-colored one:
                  // the body text inside keeps using --text-muted for the
                  // timestamp, and --text-muted over a colored -subtle fill
                  // is exactly what ui-design's "no grey on color" rule
                  // forbids. The border accent carries the "this one" signal
                  // instead.
                  highlighted && "-mx-2 border-l-2 border-brand bg-surface-hover p-2",
                )}
              >
                <Avatar className="h-7 w-7">
                  {author?.avatarUrl && <AvatarImage src={author.avatarUrl} />}
                  <AvatarFallback className="text-xs">
                    {getInitials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-xs text-text-muted">
                      {relative(c.createdAt)}
                    </span>
                    {c.updatedAt !== c.createdAt && (
                      <span className="text-xs text-text-muted">
                        (edited)
                      </span>
                    )}
                    <div className="flex-1" />
                    {mine && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setEditingId(c.id)}
                        aria-label="Edit comment"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {(mine || canModerate) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => remove(c)}
                        aria-label="Delete comment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {editingId === c.id ? (
                    <div className="mt-2">
                      <CommentComposer
                        memberIds={memberIds}
                        userMap={userMap}
                        initialContent={c.content}
                        submitLabel="Save"
                        pending={update.isPending}
                        onSubmit={(content, mentions) =>
                          saveEdit(c, content, mentions)
                        }
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                  ) : (
                    <RichTextContent html={c.content} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CommentComposer
        memberIds={memberIds}
        userMap={userMap}
        pending={create.isPending}
        onSubmit={add}
      />
    </div>
  );
}
