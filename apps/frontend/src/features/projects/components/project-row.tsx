import { Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import type { Project } from "../types";
import { ProjectStatusBadge } from "./project-status-badge";
import { dateRangeLabel } from "../format";
import { DueNote, PinButton, ProgressBar } from "./project-meta";

/** Column template shared by the header and every row, so they line up.
 *  Narrow screens keep name + progress; the rest appear as room allows. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_7rem_1.75rem] items-center gap-4 md:grid-cols-[minmax(0,1fr)_6rem_9rem_7rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_6rem_9rem_7rem_9rem_12.5rem_1.75rem]";

export function ProjectRowHeader() {
  return (
    <div className={`${ROW_GRID} text-label border-b border-border-subtle px-4 py-2`}>
      <span>Name</span>
      <span className="hidden md:block">Status</span>
      <span>Progress</span>
      <span className="hidden md:block">Deadline</span>
      <span className="hidden lg:block">Owner</span>
      <span className="hidden lg:block">Dates</span>
      <span />
    </div>
  );
}

export function ProjectRow({
  project,
  owner,
}: {
  project: Project;
  owner?: AppUser;
}) {
  const ownerName = owner?.displayName ?? "Owner";
  const tasks = project.tasks;
  const range = dateRangeLabel(project);
  return (
    <li
      className={`${ROW_GRID} group relative border-b border-border-subtle px-4 py-3 text-sm transition-colors [transition-duration:var(--duration-fast)] last:border-b-0 focus-within:bg-surface-hover hover:bg-surface-hover`}
    >
      <div className="min-w-0">
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
        >
          {project.name}
        </Link>
        {project.description && (
          <p className="truncate text-xs text-text-muted">{project.description}</p>
        )}
      </div>

      <span className="hidden md:block">
        <ProjectStatusBadge status={project.status} />
      </span>

      <span className="space-y-1">
        {tasks && (
          <>
            <span className="text-num block text-xs text-text-muted">
              {tasks.total === 0 ? "—" : `${tasks.done}/${tasks.total}`}
            </span>
            <ProgressBar tasks={tasks} />
          </>
        )}
      </span>

      <span className="hidden text-xs md:block">
        {tasks && <DueNote tasks={tasks} />}
      </span>

      <span className="hidden min-w-0 items-center gap-2 text-text-muted lg:flex">
        <Avatar size="sm">
          {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
          <AvatarFallback>{getInitials(ownerName)}</AvatarFallback>
        </Avatar>
        <span className="truncate">{ownerName}</span>
      </span>

      <span className="text-num hidden truncate text-xs text-text-muted lg:block">
        {range ?? "—"}
      </span>

      <PinButton projectId={project.id} />
    </li>
  );
}
