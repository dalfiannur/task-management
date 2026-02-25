import { useParams, useOutletContext } from "react-router";
import { useProject, useSubProjects } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen } from "lucide-react";
import type { ProjectLayoutContext } from "./project-layout";
import styles from "./project-sub-projects.module.css";

export function Component() {
  const { projectId } = useParams();
  const { openSubProjectForm } = useOutletContext<ProjectLayoutContext>();
  const { data: project } = useProject(projectId!);
  const { data: subProjects } = useSubProjects(projectId);

  if (!subProjects || subProjects.length === 0) {
    return (
      <div className={styles.emptyState}>
        <FolderOpen className={styles.emptyIcon} />
        <div className={styles.emptyText}>
          <p className={styles.emptyTitle}>No sub-projects</p>
          <p className={styles.emptySubtitle}>
            Create a sub-project to break this project into smaller parts.
          </p>
        </div>
        {project?.status.value === "on_going" && (
          <Button
            size="sm"
            variant="outline"
            className={styles.emptyBtn}
            onClick={openSubProjectForm}
          >
            <Plus className={styles.emptyBtnIcon} />
            Create Sub-Project
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      {project?.status.value === "on_going" && (
        <div className={styles.header}>
          <Button
            size="sm"
            className={styles.newSubProjectBtn}
            onClick={openSubProjectForm}
          >
            <Plus className={styles.newSubProjectBtnIcon} />
            New Sub-Project
          </Button>
        </div>
      )}
      <div className={styles.grid}>
        {subProjects.map((sub) => (
          <ProjectCard key={sub.id} project={sub} />
        ))}
      </div>
    </div>
  );
}
