import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserCombobox } from "@/components/shared/user-combobox";
import {
  useProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
} from "@/hooks/use-members";
import { useMe } from "@/hooks/use-me";
import { useUser } from "@/hooks/use-users";
import { X, UserPlus } from "lucide-react";
import { getInitials } from "@/lib/utils";

interface ProjectMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectLeaderId?: string;
}

function MemberRow({
  userId,
  isLeader,
  canManage,
  onRemove,
  isRemoving,
}: {
  userId: string;
  isLeader: boolean;
  canManage: boolean;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const { data: user } = useUser(userId);
  const displayName = user?.name ?? userId;

  return (
    <div className="flex items-center justify-between py-[0.3125rem] px-1.5 rounded-2xl transition-all duration-300 hover:bg-accent">
      <div className="flex items-center gap-1.5">
        <Avatar className="size-6">
          <AvatarImage src={user?.avatarUrl} />
          <AvatarFallback className="text-[0.5625rem]">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm leading-5">{displayName}</span>
        {isLeader && (
          <span className="font-mono text-sm font-medium uppercase tracking-widest text-muted-foreground bg-accent px-1 rounded-sm">
            Leader
          </span>
        )}
      </div>
      {canManage && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-[var(--destructive)] transition-all duration-300 active:scale-95"
          onClick={onRemove}
          disabled={isRemoving}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export function ProjectMembersDialog({
  open,
  onOpenChange,
  projectId,
  projectLeaderId,
}: ProjectMembersDialogProps) {
  const { data: members } = useProjectMembers(projectId);
  const { data: me } = useMe();
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

  const canManage =
    me?.role === "manager" || (projectLeaderId && me?.id === projectLeaderId);

  const memberUserIds = new Set(members?.map((m) => m.membership.userId) ?? []);

  const handleAdd = () => {
    if (!selectedUserId) return;
    addMember.mutate(
      { projectId, userId: selectedUserId },
      { onSuccess: () => setSelectedUserId(undefined) },
    );
  };

  const handleRemove = (userId: string) => {
    removeMember.mutate({ projectId, userId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[28rem]">
        <DialogHeader>
          <DialogTitle>Project Members</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Member list */}
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {members?.map((member) => (
              <MemberRow
                key={member.id}
                userId={member.membership.userId}
                isLeader={member.membership.userId === projectLeaderId}
                canManage={!!canManage}
                onRemove={() => handleRemove(member.membership.userId)}
                isRemoving={removeMember.isLoading}
              />
            ))}
            {(!members || members.length === 0) && (
              <p className="text-sm leading-5 text-muted-foreground text-center py-3">
                No members yet
              </p>
            )}
          </div>

          {/* Add member */}
          {canManage && (
            <div className="flex items-end gap-1.5 pt-1.5 border-t border-border">
              <div className="flex-1">
                <UserCombobox
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                />
              </div>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={
                  !selectedUserId ||
                  memberUserIds.has(selectedUserId) ||
                  addMember.isLoading
                }
              >
                <UserPlus className="size-3.5 mr-[0.3125rem]" />
                Add
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
