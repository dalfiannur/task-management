import { useNavigate } from "@tanstack/react-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useModules } from "@/hooks/use-modules";
import { useUser } from "@/hooks/use-users";
import { FolderOpen } from "lucide-react";
import type { Project, ProjectCore } from "@/types/project";
import { PROJECT_STATUS_CONFIG } from "@/types/project";
import { getProjectDisplayName } from "@/hooks/use-projects";

interface ProjectCardProps {
  project: Project & { coreDetail: ProjectCore | null };
  parentName?: string;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProjectCard({ project, parentName }: ProjectCardProps) {
  const navigate = useNavigate();
  const { data: modules } = useModules(project.id);
  const { data: pic } = useUser(project.picId?.value);

  const statusConfig = PROJECT_STATUS_CONFIG[project.status.value];

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() =>
        navigate({
          to: "/projects/$projectId",
          params: { projectId: project.id },
        })
      }
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {getProjectDisplayName(project)}
              </Badge>
              <Badge className={statusConfig.color + " border-0"}>
                {statusConfig.label}
              </Badge>
              {parentName && (
                <Badge variant="secondary" className="text-[10px]">
                  Sub: {parentName}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base">{getProjectDisplayName(project)}</CardTitle>
            {project.description && (
              <CardDescription className="line-clamp-2">
                {project.description.replace(/<[^>]*>/g, "")}
              </CardDescription>
            )}
          </div>
          <FolderOpen className="size-5 text-muted-foreground shrink-0" />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">
            {modules?.length ?? 0} module{modules?.length !== 1 ? "s" : ""}
          </p>
          {pic && (
            <div className="flex items-center gap-1.5">
              <Avatar className="size-5">
                <AvatarImage src={pic.avatarUrl} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(pic.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground">{pic.name}</span>
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
