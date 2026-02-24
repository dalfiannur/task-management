import { useParams } from "react-router";
import { useSubProjects } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/projects/project-card";
import { FolderOpen } from "lucide-react";
import styles from "./project-sub-projects.module.css";

export function Component() {
  const { projectId } = useParams();
  const { data: subProjects } = useSubProjects(projectId);

  if (!subProjects || subProjects.length === 0) {
    return (
      <div className={styles.emptyState}>
        <FolderOpen className={styles.emptyIcon} />
        <div className={styles.emptyText}>
          <p className={styles.emptyTitle}>No sub-projects</p>
          <p className={styles.emptySubtitle}>
            Create a sub-project from the dropdown menu above.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {subProjects.map((sub) => (
        <ProjectCard key={sub.id} project={sub} />
      ))}
    </div>
  );
}
