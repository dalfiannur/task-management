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
import { client, coreClient } from "@/lib/graphql-client";
import type { CoreProject } from "@/types/project";
import { useApproveLead, useDealBrief, useProjectMediaFiles } from "@/hooks/use-leads";
import { FileText } from "lucide-react";

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
  const { data: dealBrief, isLoading: briefLoading } = useDealBrief(project?.id);
  const { files: mediaFiles, isLoading: mediaLoading } = useProjectMediaFiles(project?.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    try {
      await approveProject.mutateAsync({ id: project.id, description: dealBrief?.briefDescription });
      await approveLead.mutateAsync({ id: project.id, winStage: "proposal", status: "active" });
      // Refetch sidebar queries on coreClient (leads list + project lists)
      await coreClient.refetchQueries({ include: ['ListLeadProjects', 'ListCoreProjects'] });
      // Refetch tasks project list on local backend
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold tracking-tight text-foreground">Description / Brief</span>
            {briefLoading ? (
              <p className="text-sm leading-4 text-muted-foreground font-mono">Loading brief...</p>
            ) : dealBrief?.briefDescription ? (
              <div
                className="p-3 rounded-2xl bg-accent border border-border text-sm leading-relaxed max-h-[200px] overflow-y-auto [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_ul]:pl-5 [&_ol]:pl-5"
                dangerouslySetInnerHTML={{ __html: dealBrief.briefDescription }}
              />
            ) : (
              <p className="text-sm leading-4 text-muted-foreground font-mono">No brief provided from Sales Pipeline.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold tracking-tight text-foreground">Attachments</span>
            {mediaLoading ? (
              <p className="text-sm leading-4 text-muted-foreground font-mono">Loading attachments...</p>
            ) : mediaFiles.length > 0 ? (
              <ul className="list-none p-0 m-0 flex flex-col gap-2">
                {mediaFiles.map((file) => (
                  <li key={file.id} className="flex items-center gap-2 text-muted-foreground">
                    <FileText size={16} />
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary no-underline text-sm hover:underline transition-all duration-300"
                    >
                      {file.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-4 text-muted-foreground font-mono">No attachments.</p>
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
