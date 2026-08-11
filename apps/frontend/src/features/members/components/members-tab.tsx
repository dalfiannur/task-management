import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { LogOut, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useProjectMembers } from "@/features/projects";
import { useUserMap } from "@/features/users";
import { useRemoveMember, useLeaveProject } from "../api/hooks";
import { AddMemberDialog } from "./add-member-dialog";

export function MembersTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { members, memberIds, ownerId, isLoading } = useProjectMembers(projectId);
  const userMap = useUserMap();
  const remove = useRemoveMember();
  const leave = useLeaveProject();

  const canManage = isAdmin || ownerId === me?.id;
  const iAmMember = !!me && memberIds.includes(me.id);
  const iAmOwner = ownerId === me?.id;

  // Owner first, then by name.
  const sorted = [...members].sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    const an = userMap[a.userId]?.displayName ?? a.userId;
    const bn = userMap[b.userId]?.displayName ?? b.userId;
    return an.localeCompare(bn);
  });

  function removeMember(userId: string) {
    remove.mutate(
      { projectId, userId },
      {
        onSuccess: () => toast.success("Member removed."),
        onError: (err) => toast.error(err.message || "Failed to remove"),
      },
    );
  }

  function leaveProject() {
    leave.mutate(
      { projectId },
      {
        onSuccess: () => {
          toast.success("You left the project.");
          navigate({ to: "/projects" });
        },
        onError: (err) => toast.error(err.message || "Failed to leave"),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-6">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-label">
          Members <span className="text-num">({members.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          {iAmMember && !iAmOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={leaveProject}
              disabled={leave.isPending}
            >
              <LogOut className="mr-1 h-4 w-4" />
              Leave
            </Button>
          )}
          {canManage && (
            <AddMemberDialog projectId={projectId} memberIds={memberIds} />
          )}
        </div>
      </div>

      <ul className="divide-y rounded-lg border">
        {sorted.map((m) => {
          const u = userMap[m.userId];
          const name = u?.displayName ?? m.userId;
          return (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="h-9 w-9">
                {u?.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                <AvatarFallback>{getInitials(name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{name}</span>
                  {m.isOwner && <Badge variant="secondary">Owner</Badge>}
                </div>
                {u?.phone && (
                  <span className="text-xs text-text-muted">{u.phone}</span>
                )}
              </div>
              {canManage && !m.isOwner && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => removeMember(m.userId)}
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
