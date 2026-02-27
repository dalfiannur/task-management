import { useNavigate } from "react-router";
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
import type { Project } from "@/types/project";
import { PROJECT_STATUS_CONFIG } from "@/types/project";
import { getProjectDisplayName } from "@/hooks/use-projects";
import { cn, getInitials } from "@/lib/utils";
import styles from "./project-card.module.css";

interface ProjectCardProps {
  project: Project;
  parentName?: string;
  onClick?: () => void;
}

export function ProjectCard({ project, parentName, onClick }: ProjectCardProps) {
  const navigate = useNavigate();
  const { data: modules } = useModules(project.id);
  const { data: pic } = useUser(project.projectLeaderId?.value);

  const statusConfig = PROJECT_STATUS_CONFIG[project.status.value] ?? {
    label: project.status.value,
    color: "bg-gray-100 text-gray-700",
  };

  return (
    <Card
      className={styles.card}
      onClick={() =>
        onClick ? onClick() : navigate(`/projects/${project.id}`)
      }
    >
      <CardHeader>
        <div className={styles.headerRow}>
          <div className={styles.infoGroup}>
            <div className={styles.badgeRow}>
              {project.code && (
                <Badge variant="outline" className={styles.codeBadge}>
                  {project.code}
                </Badge>
              )}
              <Badge className={cn(statusConfig.color, styles.statusBadge)}>
                {statusConfig.label}
              </Badge>
              {parentName && (
                <Badge variant="secondary" className={styles.subBadge}>
                  Sub: {parentName}
                </Badge>
              )}
              {project.linkedModule && (
                <Badge variant="outline" className={styles.moduleBadge}>
                  {project.linkedModule.name}
                </Badge>
              )}
            </div>
            <CardTitle className={styles.title}>{getProjectDisplayName(project)}</CardTitle>
            {project.description && (
              <CardDescription className="line-clamp-2">
                {project.description.replace(/<[^>]*>/g, "")}
              </CardDescription>
            )}
          </div>
          <FolderOpen className={styles.folderIcon} />
        </div>
        <div className={styles.footer}>
          <p className={styles.moduleCount}>
            {modules?.length ?? 0} module{modules?.length !== 1 ? "s" : ""}
          </p>
          {pic && (
            <div className={styles.picGroup}>
              <Avatar className={styles.picAvatar}>
                <AvatarImage src={pic.avatarUrl} />
                <AvatarFallback className={styles.picFallback}>
                  {getInitials(pic.name)}
                </AvatarFallback>
              </Avatar>
              <span className={styles.picName}>{pic.name}</span>
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
