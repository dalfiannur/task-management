import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { ChevronDown, Copy, LayoutTemplate, Pin, PinOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Avatar, AvatarFallback, AvatarImage, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "sedjiwa-ui";
import { getInitials } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useUserMap } from "@/features/users";
import { ExportDialog } from "@/features/exports";
import type { Project, ProjectStatus } from "../types";
import { PROJECT_STATUSES, STATUS_LABEL } from "../types";
import { useSetProjectStatus, useDeleteProject, useSetProjectTemplate } from "../api/hooks";
import { usePinnedProjects } from "../atoms/pins";
import { formatProjectDateRange, statusToProto } from "../api/mappers";
import { ProjectStatusBadge } from "./project-status-badge";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";
import { CreateProjectDialog } from "./create-project-dialog";

export function ProjectDetailHeader({ project }: { project: Project }) {
  const navigate = useNavigate();
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const ownerMap = useUserMap();
  const setStatus = useSetProjectStatus();
  const del = useDeleteProject();
  const setTemplate = useSetProjectTemplate();
  const [transferOpen, setTransferOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const pins = usePinnedProjects();
  const pinned = pins.isPinned(project.id);

  const canManage = isAdmin || project.ownerId === me?.id;
  const owner = ownerMap[project.ownerId];
  const ownerName = owner?.displayName ?? "Owner";
  const range = formatProjectDateRange(project);

  function changeStatus(status: ProjectStatus) {
    setStatus.mutate(
      { id: project.id, status: statusToProto(status) },
      { onError: (err) => toast.error(err.message || "Failed to set status") },
    );
  }

  function toggleTemplate() {
    const on = !project.isTemplate;
    setTemplate.mutate(
      { id: project.id, isTemplate: on },
      {
        onSuccess: () =>
          toast.success(
            on
              ? "Saved as a template. It now appears under Projects → Templates."
              : "No longer a template.",
          ),
        onError: (err) => toast.error(err.message || "Failed to update"),
      },
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
    <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
          {project.isTemplate && <Badge variant="secondary">Template</Badge>}
        </div>
        {project.description && (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Avatar size="sm">
              {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
              <AvatarFallback>
                {getInitials(ownerName)}
              </AvatarFallback>
            </Avatar>
            {ownerName}
          </span>
          {range && <span className="text-num">· {range}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Pinning is a personal sidebar preference, so every member gets it —
            unlike the management actions after it. */}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={pinned}
          onClick={() => pins.toggle(project.id)}
        >
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          {pinned ? "Unpin" : "Pin"}
        </Button>

        <CreateProjectDialog
          source={{ id: project.id, name: project.name }}
          trigger={
            <Button variant={project.isTemplate ? "default" : "outline"} size="sm">
              <Copy className="h-4 w-4" />
              {project.isTemplate ? "Use template" : "Duplicate"}
            </Button>
          }
        />

        {canManage && (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={project.isTemplate}
              disabled={setTemplate.isPending}
              onClick={toggleTemplate}
            >
              <LayoutTemplate className="h-4 w-4" />
              {project.isTemplate ? "Unmark template" : "Save as template"}
            </Button>

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

            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportOpen(true)}
            >
              Export
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

            <ExportDialog
              projectId={project.id}
              open={exportOpen}
              onOpenChange={setExportOpen}
            />
          </>
        )}
      </div>
    </div>
  );
}
