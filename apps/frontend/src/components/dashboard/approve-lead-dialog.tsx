import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApproveProject } from "@/hooks/use-projects";
import type { Project } from "@/types/project";
import { useApproveLead } from "@/hooks/use-leads";
import styles from "./approve-lead-dialog.module.css";

interface ApproveLeadDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApproveLeadDialog({
  project,
  open,
  onOpenChange,
}: ApproveLeadDialogProps) {
  const [description, setDescription] = useState("");
  const approveProject = useApproveProject();
  const approveLead = useApproveLead();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;

    approveProject.mutate(
      { id: project.id, description },
      {
        onSuccess: () => {
          approveLead.mutate(
            { id: project.id, winStage: "inactive" },
            {
              onSuccess: () => {
                setDescription("");
                onOpenChange(false);
              }
            }
          )
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve Lead — {project?.coreName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.fieldGroup}>
            <Label htmlFor="description">Description / Brief</Label>
            <RichTextEditor
              content={description}
              onChange={setDescription}
              placeholder="Enter project brief..."
            />
          </div>
          <div className={styles.fieldGroup}>
            <Label htmlFor="attachments">Attachment Files</Label>
            <Input id="attachments" type="file" multiple />
            <p className={styles.hint}>
              Optional. Upload relevant documents.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={approveProject.isLoading}>
              {approveProject.isLoading ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
