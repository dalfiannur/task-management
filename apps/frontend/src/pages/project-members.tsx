import { useState } from "react";
import { useParams } from "react-router";
import { useProject } from "@/hooks/use-projects";
import {
  useProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
} from "@/hooks/use-members";
import { useUsers } from "@/hooks/use-users";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserCombobox } from "@/components/shared/user-combobox";
import { X, UserPlus, Users } from "lucide-react";
import { getInitials } from "@/lib/utils";
import styles from "./project-members.module.css";

export function Component() {
  const { projectId } = useParams();
  const { data: project } = useProject(projectId!);
  const { data: members } = useProjectMembers(projectId!);
  const { data: users } = useUsers();
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

  const projectLeaderId = project?.projectLeaderId?.value;

  const memberUserIds = new Set(
    members?.map((m) => m.membership.userId) ?? [],
  );

  const handleAdd = () => {
    if (!selectedUserId) return;
    addMember.mutate(
      { projectId: projectId!, userId: selectedUserId },
      { onSuccess: () => setSelectedUserId(undefined) },
    );
  };

  const handleRemove = (userId: string) => {
    removeMember.mutate({ projectId: projectId!, userId });
  };

  return (
    <div className={styles.container}>
      {/* Add member bar */}
      <div className={styles.addBar}>
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

      {/* Member cards grid */}
      {members && members.length > 0 ? (
        <div className={styles.grid}>
          {members.map((member) => {
            const user = users?.find(
              (u) => u.id === member.membership.userId,
            );
            const displayName = user?.name ?? member.membership.userId;
            return (
              <div key={member.id} className={styles.memberCard}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={styles.removeButton}
                  onClick={() => handleRemove(member.membership.userId)}
                  disabled={removeMember.isLoading}
                >
                  <X className={styles.removeIcon} />
                </Button>
                <Avatar className={styles.memberAvatar}>
                  <AvatarImage src={user?.avatarUrl} />
                  <AvatarFallback className={styles.memberFallback}>
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className={styles.memberName}>{displayName}</span>
                {member.membership.userId === projectLeaderId && (
                  <span className={styles.picBadge}>Leader</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <Users className={styles.emptyIcon} />
          <p className={styles.emptyMessage}>No members yet</p>
          <p className={styles.emptyHint}>
            Use the form above to add members to this project.
          </p>
        </div>
      )}
    </div>
  );
}
