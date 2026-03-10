import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserCombobox } from "@/components/shared/user-combobox";
import { useUpdateCoreProject, useUpdateLocalProject } from "@/hooks/use-projects";
import type { CoreProject } from "@/types/project";

interface AssignLeaderDialogProps {
  project: CoreProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignLeaderDialog({
  project,
  open,
  onOpenChange,
}: AssignLeaderDialogProps) {
  const [projectLeaderId, setProjectLeaderId] = useState<string | undefined>(project.ref?.leaderId);
  const updateCoreProject = useUpdateCoreProject();
  const updateLocalProject = useUpdateLocalProject();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectLeaderId) return;
    updateCoreProject.mutate(
      {
        id: project.id,
        projectLeaderId,
      },
      {
        onSuccess: () => {
          updateLocalProject.mutate({ id: project.id, projectLeaderId });
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Assign Project Leader — {project.name?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3.5">
            <div className="flex flex-col gap-1.5">
              <Label>Project Leader</Label>
              <UserCombobox value={projectLeaderId} onChange={setProjectLeaderId} />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!projectLeaderId || updateCoreProject.isLoading}>
              {updateCoreProject.isLoading ? "Saving..." : "Assign Leader"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
