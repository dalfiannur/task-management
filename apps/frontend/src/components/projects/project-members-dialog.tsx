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
import { useUsers } from "@/hooks/use-users";
import { X, UserPlus } from "lucide-react";

interface ProjectMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  picId?: string;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProjectMembersDialog({
  open,
  onOpenChange,
  projectId,
  picId,
}: ProjectMembersDialogProps) {
  const { data: members } = useProjectMembers(projectId);
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

  const canManage =
    me?.role === "manager" || (picId && me?.externalId === picId);

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Members</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Member list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {members?.map((member) => {
              const user = users?.find(
                (u) => u.id === member.membership.userId,
              );
              const displayName = user?.name ?? member.membership.userId;
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="size-7">
                      <AvatarImage src={user?.avatarUrl} />
                      <AvatarFallback className="text-[10px]">
                        {getInitials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{displayName}</span>
                    {member.membership.userId === picId && (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        PIC
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(member.membership.userId)}
                      disabled={removeMember.isPending}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
            {(!members || members.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No members yet
              </p>
            )}
          </div>

          {/* Add member */}
          {canManage && (
            <div className="flex items-end gap-2 pt-2 border-t">
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
                  addMember.isPending
                }
              >
                <UserPlus className="size-3.5 mr-1.5" />
                Add
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
