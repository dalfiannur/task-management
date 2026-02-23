import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectForm } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import styles from "./projects.module.css";

export function Component() {
  const { data: allProjects, isLoading } = useProjects();
  const projects = allProjects?.filter((p) => p.status.value !== "pending");
  const nameMap = new Map(
    projects?.map((p) => [p.id, getProjectDisplayName(p)]),
  );
  const [formOpen, setFormOpen] = useState(false);

  if (isLoading) {
    return (
      <div className={styles.skeletonGrid}>
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className={styles.btnIcon} />
          New Project
        </Button>
      </div>
      <div className={styles.grid}>
        {projects?.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            parentName={
              project.parent ? nameMap.get(project.parent.id) : undefined
            }
          />
        ))}
      </div>
      {projects?.length === 0 && (
        <p className={styles.empty}>
          No projects yet. Create one to get started.
        </p>
      )}
      <ProjectForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
