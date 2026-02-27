import { useSearchParams } from "react-router";
import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { useNewLeads } from "@/hooks/use-leads";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectForm } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/project";
import styles from "./projects.module.css";

type ProjectFilter = "active" | "closed" | "all";
type ProjectType = "internal" | "leads" | "commercial";

const TYPE_TITLES: Record<ProjectType, string> = {
  internal: "Internal Projects",
  leads: "New Leads",
  commercial: "Commercial Projects",
};

function isInternalProject(p: Project): boolean {
  return !p.winStage;
}

function isCommercialProject(p: Project): boolean {
  return !!p.winStage && p.winStage !== "pending";
}

export function Component() {
  const [searchParams] = useSearchParams();
  const projectType = searchParams.get("type") as ProjectType | null;

  const { data: allProjects, isLoading } = useProjects();
  const { data: leads, isLoading: isLeadsLoading } = useNewLeads();
  const [filter, setFilter] = useState<ProjectFilter>("active");
  const [formOpen, setFormOpen] = useState(false);

  const isLeadsView = projectType === "leads";

  // For leads view, use leads data directly
  if (isLeadsView) {
    const title = TYPE_TITLES.leads;
    if (isLeadsLoading) {
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
          <h1 className={styles.title}>{title}</h1>
        </div>
        <div className={styles.grid}>
          {leads?.map((lead) => (
            <ProjectCard key={lead.id} project={lead} />
          ))}
        </div>
        {(!leads || leads.length === 0) && (
          <p className={styles.empty}>No new leads.</p>
        )}
      </div>
    );
  }

  // For internal/commercial/all views, use allProjects
  const rootProjects = allProjects?.filter((p) => !p.parent?.id && p.status.value !== "pending");

  const typeFiltered = rootProjects?.filter((p) => {
    if (projectType === "internal") return isInternalProject(p);
    if (projectType === "commercial") return isCommercialProject(p);
    return true;
  });

  const projects = typeFiltered?.filter((p) => {
    if (filter === "active") return p.status.value !== "closed";
    if (filter === "closed") return p.status.value === "closed";
    return true;
  });

  const nameMap = new Map(
    rootProjects?.map((p) => [p.id, getProjectDisplayName(p)]),
  );

  const closedCount = typeFiltered?.filter((p) => p.status.value === "closed").length ?? 0;
  const title = projectType ? TYPE_TITLES[projectType] : "Projects";
  const showNewButton = !projectType || projectType === "internal";

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
        <h1 className={styles.title}>{title}</h1>
        {showNewButton && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className={styles.btnIcon} />
            New Project
          </Button>
        )}
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
          {projectType === "commercial"
            ? "No commercial projects."
            : "No projects yet. Create one to get started."}
        </p>
      )}
      <ProjectForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
