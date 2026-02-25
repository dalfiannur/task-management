import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectForm } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./projects.module.css";

type ProjectFilter = "active" | "closed" | "all";

export function Component() {
  const { data: allProjects, isLoading } = useProjects();
  const nonPending = allProjects?.filter((p) => p.status.value !== "pending");
  const [filter, setFilter] = useState<ProjectFilter>("active");

  const projects = nonPending?.filter((p) => {
    if (filter === "active") return p.status.value !== "closed";
    if (filter === "closed") return p.status.value === "closed";
    return true;
  });

  const nameMap = new Map(
    nonPending?.map((p) => [p.id, getProjectDisplayName(p)]),
  );
  const [formOpen, setFormOpen] = useState(false);

  const closedCount = nonPending?.filter((p) => p.status.value === "closed").length ?? 0;

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
      <div className={styles.filterTabs}>
        <button
          className={cn(styles.filterTab, filter === "active" && styles.filterTabActive)}
          onClick={() => setFilter("active")}
        >
          Active
        </button>
        <button
          className={cn(styles.filterTab, filter === "closed" && styles.filterTabActive)}
          onClick={() => setFilter("closed")}
        >
          Closed{closedCount > 0 && <span className={styles.filterCount}>{closedCount}</span>}
        </button>
        <button
          className={cn(styles.filterTab, filter === "all" && styles.filterTabActive)}
          onClick={() => setFilter("all")}
        >
          All
        </button>
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
