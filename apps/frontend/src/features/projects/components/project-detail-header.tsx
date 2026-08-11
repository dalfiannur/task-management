import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getInitials } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useUserMap } from "@/features/users";
import type { Project, ProjectStatus } from "../types";
import { PROJECT_STATUSES, STATUS_LABEL } from "../types";
import { useSetProjectStatus, useDeleteProject } from "../api/hooks";
import { statusToProto } from "../api/mappers";
import { ProjectStatusBadge } from "./project-status-badge";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

export function ProjectDetailHeader({ project }: { project: Project }) {
  const navigate = useNavigate();
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const ownerMap = useUserMap();
  const setStatus = useSetProjectStatus();
  const del = useDeleteProject();
  const [transferOpen, setTransferOpen] = useState(false);

  const canManage = isAdmin || project.ownerId === me?.id;
  const owner = ownerMap[project.ownerId];
  const ownerName = owner?.displayName ?? "Owner";
  const range =
    project.startDate || project.endDate
      ? `${project.startDate ?? "…"} → ${project.endDate ?? "…"}`
      : null;

  function changeStatus(status: ProjectStatus) {
    setStatus.mutate(
      { id: project.id, status: statusToProto(status) },
      { onError: (err) => toast.error(err.message || "Failed to set status") },
    );
  }

  function onDelete() {
    del.mutate(
      { id: project.id },
      {
        onSuccess: () => {
          toast.success("Project deleted.");
          navigate({ to: "/projects" });
        },
        onError: (err) => toast.error(err.message || "Delete failed"),
      },
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
        </div>
        {project.description && (
          <p className="max-w-2xl text-sm text-text-muted">
            {project.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <span className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
              <AvatarFallback className="text-xs">
                {getInitials(ownerName)}
              </AvatarFallback>
            </Avatar>
            {ownerName}
          </span>
          {range && <span>· {range}</span>}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Status <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {PROJECT_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={s === project.status}
                  onClick={() => changeStatus(s)}
                >
                  {STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setTransferOpen(true)}
          >
            Transfer
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes “{project.name}” and its memberships.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <TransferOwnershipDialog
            projectId={project.id}
            currentOwnerId={project.ownerId}
            open={transferOpen}
            onOpenChange={setTransferOpen}
          />
        </div>
      )}
    </div>
  );
}
