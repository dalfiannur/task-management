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
import { getInitials } from "@/lib/utils";
import styles from "./project-members-dialog.module.css";

interface ProjectMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectLeaderId?: string;
}

export function ProjectMembersDialog({
  open,
  onOpenChange,
  projectId,
  projectLeaderId,
}: ProjectMembersDialogProps) {
  const { data: members } = useProjectMembers(projectId);
  const { data: users } = useUsers();
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
      <DialogContent className={styles.dialogContent}>
        <DialogHeader>
          <DialogTitle>Project Members</DialogTitle>
        </DialogHeader>
        <div className={styles.body}>
          {/* Member list */}
          <div className={styles.memberList}>
            {members?.map((member) => {
              const user = users?.find(
                (u) => u.id === member.membership.userId,
              );
              const displayName = user?.name ?? member.membership.userId;
              return (
                <div
                  key={member.id}
                  className={styles.memberRow}
                >
                  <div className={styles.memberInfo}>
                    <Avatar className={styles.memberAvatar}>
                      <AvatarImage src={user?.avatarUrl} />
                      <AvatarFallback className={styles.memberFallback}>
                        {getInitials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className={styles.memberName}>{displayName}</span>
                    {member.membership.userId === projectLeaderId && (
                      <span className={styles.picBadge}>
                        Leader
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={styles.removeButton}
                      onClick={() => handleRemove(member.membership.userId)}
                      disabled={removeMember.isLoading}
                    >
                      <X className={styles.removeIcon} />
                    </Button>
                  )}
                </div>
              );
            })}
            {(!members || members.length === 0) && (
              <p className={styles.emptyMessage}>
                No members yet
              </p>
            )}
          </div>

          {/* Add member */}
          {canManage && (
            <div className={styles.addSection}>
              <div className={styles.addCombobox}>
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
                <UserPlus className={styles.addIcon} />
                Add
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
