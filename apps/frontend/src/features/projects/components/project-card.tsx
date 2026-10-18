import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "sedjiwa-ui";
import { getInitials } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import type { Project } from "../types";
import { ProjectStatusBadge } from "./project-status-badge";
import { dateRangeLabel, donePct } from "../format";
import { DueNote, PinButton, ProgressBar } from "./project-meta";

export function ProjectCard({
  project,
  owner,
}: {
  project: Project;
  owner?: AppUser;
}) {
  const range = dateRangeLabel(project);
  const ownerName = owner?.displayName ?? "Owner";
  const tasks = project.tasks;
  return (
    <article className="group relative flex h-full flex-col gap-4 rounded-xl bg-card p-4 shadow-sm transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)] focus-within:shadow-md hover:shadow-md">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          {project.isTemplate ? (
            <Badge variant="secondary">Template</Badge>
          ) : (
            <ProjectStatusBadge status={project.status} />
          )}
          <h3 className="truncate font-medium leading-tight">
            {/* Menaut ke rute telanjang, BUKAN ke tab tertentu: tab mana yang
                menyambut diputuskan sekali di
                `routes/_authed/projects/$projectId/index.tsx`. Link-nya
                di-stretch menutupi seluruh kartu; tombol pin duduk di atasnya. */}
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {project.name}
            </Link>
          </h3>
        </div>
        <PinButton projectId={project.id} className="-mr-1 -mt-1" />
      </header>

      <p className="line-clamp-2 min-h-[2lh] text-sm text-muted-foreground">
        {project.description || (
          <span className="text-muted-foreground">No description</span>
        )}
      </p>

      {range && (
        <p className="text-num -mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {range}
        </p>
      )}

      {/* A template is a blueprint: how big it is, not how it is doing. */}
      {tasks && project.isTemplate && (
        <p className="text-xs text-muted-foreground">
          <span className="text-num font-medium text-foreground">{tasks.total}</span>{" "}
          {tasks.total === 1 ? "task" : "tasks"}
        </p>
      )}

      {tasks && !project.isTemplate && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {tasks.total === 0 ? (
                "No tasks yet"
              ) : (
                <>
                  <span className="text-num font-medium text-foreground">
                    {tasks.done}/{tasks.total}
                  </span>{" "}
                  tasks done
                </>
              )}
            </span>
            {tasks.total > 0 && (
              <span className="text-num text-muted-foreground">{donePct(tasks)}%</span>
            )}
          </div>
          <ProgressBar tasks={tasks} />
        </div>
      )}

      <footer className="mt-auto flex items-center gap-3 border-t border-border pt-3 text-xs">
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Avatar size="sm">
            {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
            <AvatarFallback>{getInitials(ownerName)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{ownerName}</span>
        </span>
        <span className="ml-auto shrink-0 text-right">
          {tasks && !project.isTemplate && <DueNote tasks={tasks} />}
        </span>
      </footer>
    </article>
  );
}
