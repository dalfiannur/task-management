import { Link, useNavigate } from "react-router";
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
import type { CoreProject } from "@/types/project";
import { getInitials } from "@/lib/utils";
import styles from "./active-projects.module.css";

interface ActiveProjectsProps {
  projects: CoreProject[];
}

export function ActiveProjects({ projects }: ActiveProjectsProps) {
  const activeProjects = projects
    .filter((p) => p.status === "active" && p.winStage !== "pending")
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className={styles.headerRow}>
        <CardTitle className={styles.cardTitle}>
          Active Projects
        </CardTitle>
        <Link
          to="/projects"
          className={styles.viewAllLink}
        >
          View all &rarr;
        </Link>
      </CardHeader>
      <CardContent className={styles.projectList}>
        {activeProjects.length === 0 ? (
          <p className={styles.emptyText}>
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

function ProjectItem({ project }: { project: CoreProject }) {
  const navigate = useNavigate();
  const { data: modules } = useModules(project.id);
  const { data: pic } = useUser(project.ref?.leaderId);

  return (
    <div
      className={styles.projectItem}
      onClick={() =>
        navigate(`/projects/${project.id}`)
      }
    >
      <div className={styles.projectIconWrapper}>
        <FolderOpen className={styles.projectIcon} />
      </div>
      <div className={styles.projectContent}>
        <p className={styles.projectName}>{project.name?.name ?? "Untitled"}</p>
        <div className={styles.projectMeta}>
          <span className={styles.moduleCount}>
            {modules?.length ?? 0} modules
          </span>
          {pic && (
            <>
              <span className={styles.metaSeparator}>&middot;</span>
              <Avatar className={styles.avatar}>
                <AvatarImage src={pic.avatarUrl} />
                <AvatarFallback className={styles.avatarFallback}>
                  {getInitials(pic.name)}
                </AvatarFallback>
              </Avatar>
              <span className={styles.picName}>
                {pic.name}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className={styles.chevron} />
    </div>
  );
}
