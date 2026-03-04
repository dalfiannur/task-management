import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useApproveProject } from "@/hooks/use-projects";
import { client } from "@/lib/graphql-client";
import type { CoreProject } from "@/types/project";
import { useApproveLead, useDealBrief, useProjectMediaFiles } from "@/hooks/use-leads";
import { FileText } from "lucide-react";
import styles from "./approve-lead-dialog.module.css";

interface ApproveLeadDialogProps {
  project: CoreProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApproveLeadDialog({
  project,
  open,
  onOpenChange,
}: ApproveLeadDialogProps) {
  const approveProject = useApproveProject();
  const approveLead = useApproveLead();
  const { data: dealBrief, isLoading: briefLoading } = useDealBrief(project?.id, project?.ref?.companyId);
  const { files: mediaFiles, isLoading: mediaLoading } = useProjectMediaFiles(project?.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    try {
      await approveProject.mutateAsync({ id: project.id, description: dealBrief?.briefDescription });
      await approveLead.mutateAsync({ id: project.id, winStage: "proposal" });
      // Refetch tasks project list after Core winStage is updated so commercial section shows it
      await client.refetchQueries({ include: ['ListProjects'] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve lead. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve Lead — {project?.name?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.fieldGroup}>
            <span className={styles.label}>Description / Brief</span>
            {briefLoading ? (
              <p className={styles.hint}>Loading brief...</p>
            ) : dealBrief?.briefDescription ? (
              <div
                className={styles.briefContent}
                dangerouslySetInnerHTML={{ __html: dealBrief.briefDescription }}
              />
            ) : (
              <p className={styles.hint}>No brief provided from Sales Pipeline.</p>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.label}>Attachments</span>
            {mediaLoading ? (
              <p className={styles.hint}>Loading attachments...</p>
            ) : mediaFiles.length > 0 ? (
              <ul className={styles.fileList}>
                {mediaFiles.map((file) => (
                  <li key={file.id} className={styles.fileItem}>
                    <FileText size={16} />
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.fileLink}
                    >
                      {file.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>No attachments.</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={approveProject.isLoading || briefLoading}>
              {approveProject.isLoading ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
