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
    /* Menaut ke rute telanjang, BUKAN ke tab tertentu. Kartu ini berarti
       "buka project ini", dan tab mana yang menyambut adalah keputusan tunggal
       yang tinggal di `routes/_authed/projects/$projectId/index.tsx`. Sebelumnya
       kartu ini menaut langsung ke `/all-tasks`, sehingga redirect default di
       index tidak pernah terpakai — mengubah tab default jadi tidak berefek
       apa-apa dari pintu masuk utama. */
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="block"
    >
      <Card className="h-full transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)] hover:shadow-3">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <span className="font-medium leading-tight">{project.name}</span>
          <ProjectStatusBadge status={project.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          {project.description && (
            <p className="line-clamp-2 text-sm text-text-muted">
              {project.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Avatar className="h-6 w-6">
              {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
              <AvatarFallback className="text-xs">
                {getInitials(ownerName)}
              </AvatarFallback>
            </Avatar>
            <span>{ownerName}</span>
          </div>
          {range && <p className="text-num text-xs text-text-muted">{range}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
