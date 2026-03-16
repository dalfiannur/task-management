import { useSearchParams } from "react-router";
import { useProjects } from "@/hooks/use-projects";
import { useNewLeads } from "@/hooks/use-leads";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectForm } from "@/components/projects/project-form";
import { ApproveLeadDialog } from "@/components/dashboard/approve-lead-dialog";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, Search, ArrowUpDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { CoreProject } from "@/types/project";
import { useCompanyStore } from "@/stores/company-store";
import { useHasPermission } from "@/hooks/use-me";

type ProjectFilter = "active" | "closed" | "all";
type ProjectType = "internal" | "leads" | "commercial";
type SortOption = "name-asc" | "name-desc" | "date-desc" | "date-asc";

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
  const canManageLeads = useHasPermission("task_management:projects", "create_all");
  const [filter, setFilter] = useState<ProjectFilter>("active");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("date-desc");
  const [formOpen, setFormOpen] = useState(false);
  const [approveProject, setApproveProject] = useState<CoreProject | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);

  const isLeadsView = projectType === "leads" && canManageLeads;

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
        ...(filter === "closed"
          ? { status: ["completed"] }
          : projectType === "commercial"
            ? { status: ["active", "completed", "archived"] }
            : {}),
        page,
        limit: PAGE_LIMIT,
      };

  const { data: allProjects, isLoading } = useProjects(queryInput);
  const { data: leads, isLoading: isLeadsLoading } = useNewLeads(
    isLeadsView ? (selectedCompanyId ?? undefined) : undefined,
    !isLeadsView,
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filter, projectType, selectedCompanyId]);

  // Client-side filtering, searching, and sorting
  const projects = useMemo(() => {
    let result = allProjects?.filter(
      (p) =>
        p.winStage !== "pending" &&
        // For commercial projects, show sub-projects (they are the commercial engagement)
        (projectType === "commercial" || !p.ref?.parentId),
    );

    // Search by name or client
    if (search.trim() && result) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          (p.name?.name ?? "").toLowerCase().includes(q) ||
          (p.code ?? "").toLowerCase().includes(q) ||
          (p.clientDetail?.name?.name ?? "").toLowerCase().includes(q),
      );
    }

    // Sort
    if (result) {
      const getName = (p: CoreProject) => p.name?.name ?? "";
      result = [...result].sort((a, b) => {
        switch (sort) {
          case "name-asc":
            return getName(a).localeCompare(getName(b));
          case "name-desc":
            return getName(b).localeCompare(getName(a));
          case "date-asc":
            return (a.dates?.startDate ?? a.id).localeCompare(b.dates?.startDate ?? b.id);
          case "date-desc":
            return (b.dates?.startDate ?? b.id).localeCompare(a.dates?.startDate ?? a.id);
          default:
            return 0;
        }
      });
    }

    return result;
  }, [allProjects, search, sort, projectType]);

  const hasNextPage = (allProjects?.length ?? 0) === PAGE_LIMIT;
  const title = projectType ? TYPE_TITLES[projectType] : "Projects";
  const showNewButton = !projectType || projectType === "internal";

  // --- All hooks called above this line ---

  // Unauthorized users on leads view
  if (projectType === "leads" && !canManageLeads) {
    return (
      <div className="p-5">
        <p className="text-center text-muted-foreground py-10">
          You don't have permission to manage leads.
        </p>
      </div>
    );
  }

  // Leads view
  if (isLeadsView) {
    if (isLeadsLoading) {
      return (
        <div className="p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      );
    }
    return (
      <div className="p-5">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">{TYPE_TITLES.leads}</h1>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <p className="text-center text-muted-foreground py-10">No new leads.</p>
        )}
        <ApproveLeadDialog
          project={approveProject}
          open={approveDialogOpen}
          onOpenChange={setApproveDialogOpen}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">{title}</h1>
        {showNewButton && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New Project
          </Button>
        )}
      </div>
      <div className="flex items-center border-b border-border mb-4">
        {(["active", "closed", "all"] as const).map((tab) => (
          <Button
            variant="ghost"
            key={tab}
            className={cn(
              "relative px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors",
              filter === tab && "text-foreground after:absolute after:bottom-[-1px] after:left-2 after:right-2 after:h-0.5 after:bg-foreground after:rounded-sm",
            )}
            onClick={() => setFilter(tab)}
          >
            {tab === "active" ? "Active" : tab === "closed" ? "Closed" : "All"}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-80">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!pl-8 h-9 text-sm"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger className="w-auto min-w-36 h-9 text-sm gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Newest first</SelectItem>
            <SelectItem value="date-asc">Oldest first</SelectItem>
            <SelectItem value="name-asc">Name A–Z</SelectItem>
            <SelectItem value="name-desc">Name Z–A</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
          />
        ))}
      </div>
      {projects?.length === 0 && (
        <p className="text-center text-muted-foreground py-10">
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
