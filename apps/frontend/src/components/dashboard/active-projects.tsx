import { Link, useNavigate } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useModules } from "@/hooks/use-modules";
import { useUser } from "@/hooks/use-users";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FolderOpen, ChevronRight } from "lucide-react";
import type { Project, ProjectCore } from "@/types/project";

type ProjectWithCore = Project & { coreDetail: ProjectCore | null };

interface ActiveProjectsProps {
  projects: ProjectWithCore[];
}

export function ActiveProjects({ projects }: ActiveProjectsProps) {
  const activeProjects = projects
    .filter((p) => p.status.value === "on_going")
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold">
          Active Projects
        </CardTitle>
        <Link
          to="/projects"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all &rarr;
        </Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {activeProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No active projects.
          </p>
        ) : (
          activeProjects.map((project) => (
            <ProjectItem key={project.id} project={project} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function ProjectItem({ project }: { project: ProjectWithCore }) {
  const navigate = useNavigate();
  const { data: modules } = useModules(project.id);
  const { data: pic } = useUser(project.picId?.value);

  return (
    <div
      className="flex items-center gap-3 rounded-lg p-2.5 -mx-1 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() =>
        navigate({
          to: "/projects/$projectId",
          params: { projectId: project.id },
        })
      }
    >
      <div className="rounded-lg p-2 shrink-0 bg-emerald-500/10">
        <FolderOpen className="size-4 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{project.coreDetail?.name.name ?? "Untitled"}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground">
            {modules?.length ?? 0} modules
          </span>
          {pic && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <Avatar className="size-4">
                <AvatarImage src={pic.avatarUrl} />
                <AvatarFallback className="text-[8px]">
                  {getInitials(pic.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground truncate">
                {pic.name}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground/50 shrink-0" />
    </div>
  );
}
