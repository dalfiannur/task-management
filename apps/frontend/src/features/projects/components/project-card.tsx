import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import type { Project } from "../types";
import { ProjectStatusBadge } from "./project-status-badge";

function dateRange(start?: string, end?: string): string | null {
  if (!start && !end) return null;
  return `${start ?? "…"} → ${end ?? "…"}`;
}

export function ProjectCard({
  project,
  owner,
}: {
  project: Project;
  owner?: AppUser;
}) {
  const range = dateRange(project.startDate, project.endDate);
  const ownerName = owner?.displayName ?? "Owner";
  return (
    <Link
      to="/projects/$projectId/all-tasks"
      params={{ projectId: project.id }}
      className="block"
    >
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <span className="font-medium leading-tight">{project.name}</span>
          <ProjectStatusBadge status={project.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          {project.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Avatar className="h-6 w-6">
              {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
              <AvatarFallback className="text-xs">
                {getInitials(ownerName)}
              </AvatarFallback>
            </Avatar>
            <span>{ownerName}</span>
          </div>
          {range && (
            <p className="text-xs text-muted-foreground">{range}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
