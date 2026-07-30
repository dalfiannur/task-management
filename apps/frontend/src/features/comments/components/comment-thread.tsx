import { useState } from "react";
import { useAtomValue } from "jotai";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
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
export function CommentThread({ taskId, projectId }: { taskId: string; projectId: string }) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { comments, isLoading } = useComments(taskId);
  const { memberIds, ownerId } = useProjectMembers(projectId);
  const userMap = useUserMap();
  const create = useCreateComment();
  const update = useUpdateComment();
  const del = useDeleteComment();
  const [editingId, setEditingId] = useState<string | null>(null);

  const canModerate = isAdmin || ownerId === me?.id;

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
          <span className="text-muted-foreground">({comments.length})</span>
        )}
      </h4>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => {
            const author = userMap[c.authorId];
            const name = author?.displayName ?? c.authorId;
            const mine = c.authorId === me?.id;
            return (
              <li key={c.id} className="flex gap-3">
                <Avatar className="h-7 w-7">
                  {author?.avatarUrl && <AvatarImage src={author.avatarUrl} />}
                  <AvatarFallback className="text-xs">
                    {getInitials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {relative(c.createdAt)}
                    </span>
                    {c.updatedAt !== c.createdAt && (
                      <span className="text-xs text-muted-foreground">
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
                        initialMentions={c.mentionedUserIds}
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
