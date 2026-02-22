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
import type { Project, ProjectCore } from "@/types/project";
import { useApproveLead } from "@/hooks/use-leads";

type ProjectWithCore = Project & { coreDetail: ProjectCore | null };

interface ApproveLeadDialogProps {
  project: ProjectWithCore | null;
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
      { id: project.id, name: project.coreDetail?.name.name ?? "", description },
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
          <DialogTitle>Approve Lead — {project?.coreDetail?.name.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Description / Brief</Label>
            <RichTextEditor
              content={description}
              onChange={setDescription}
              placeholder="Enter project brief..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attachments">Attachment Files</Label>
            <Input id="attachments" type="file" multiple />
            <p className="text-xs text-muted-foreground">
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
            <Button type="submit" disabled={approveProject.isPending}>
              {approveProject.isPending ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
