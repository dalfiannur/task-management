import { useSearchParams } from "react-router";
import { useProjects } from "@/hooks/use-projects";
import { useNewLeads } from "@/hooks/use-leads";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectForm } from "@/components/projects/project-form";
import { ApproveLeadDialog } from "@/components/dashboard/approve-lead-dialog";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CoreProject } from "@/types/project";
import { useCompanyStore } from "@/stores/company-store";
import styles from "./projects.module.css";

type ProjectFilter = "active" | "closed" | "all";
type ProjectType = "internal" | "leads" | "commercial";

const TYPE_TITLES: Record<ProjectType, string> = {
  internal: "Internal Projects",
  leads: "New Leads",
  commercial: "Commercial Projects",
};

const PAGE_LIMIT = 12;

export function Component() {
  const [searchParams] = useSearchParams();
  const projectType = searchParams.get("type") as ProjectType | null;

  const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
  const [filter, setFilter] = useState<ProjectFilter>("active");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [approveProject, setApproveProject] = useState<CoreProject | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);

  const isLeadsView = projectType === "leads";

  // Build server-side query params
  const queryInput = isLeadsView
    ? undefined
    : {
        ...(selectedCompanyId ? { ownerId: selectedCompanyId } : {}),
        ...(projectType === "commercial"
          ? { commercial: true }
          : projectType === "internal"
            ? { commercial: false }
            : {}),
        ...(filter === "closed" ? { status: "completed" } : {}),
        page,
        limit: PAGE_LIMIT,
      };

  const { data: allProjects, isLoading } = useProjects(queryInput);
  const { data: leads, isLoading: isLeadsLoading } = useNewLeads(
    isLeadsView ? (selectedCompanyId ?? undefined) : undefined,
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filter, projectType, selectedCompanyId]);

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
            <ProjectCard
              key={lead.id}
              project={lead}
              onClick={() => {
                setApproveProject(lead);
                setApproveDialogOpen(true);
              }}
            />
          ))}
        </div>
        {(!leads || leads.length === 0) && (
          <p className={styles.empty}>No new leads.</p>
        )}
        <ApproveLeadDialog
          project={approveProject}
          open={approveDialogOpen}
          onOpenChange={setApproveDialogOpen}
        />
      </div>
    );
  }

  // Client-side filtering for what the server can't express
  const projects = allProjects?.filter(
    (p) => !p.ref?.parentId && p.winStage !== "pending",
  );

  const hasNextPage = (allProjects?.length ?? 0) === PAGE_LIMIT;

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
          Closed
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
      <Pagination
        currentPage={page}
        hasNextPage={hasNextPage}
        onPageChange={setPage}
      />
      <ProjectForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
