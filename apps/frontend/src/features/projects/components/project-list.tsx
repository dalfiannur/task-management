import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/users";
import { useProjects } from "../api/hooks";
import type { ProjectStatus } from "../types";
import { ProjectCard } from "./project-card";
import { CreateProjectDialog } from "./create-project-dialog";

type Filter = ProjectStatus | "all";

const FILTERS: { key: Filter; label: string; statuses: ProjectStatus[] }[] = [
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "all", label: "All", statuses: [] },
];

export function ProjectList() {
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const statuses = FILTERS.find((f) => f.key === filter)?.statuses ?? [];
  const { data, isLoading, isError, error, pageSize } = useProjects({
    statuses,
    search,
    page,
  });
  const ownerMap = useUserMap();

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  function selectFilter(f: Filter) {
    setFilter(f);
    setPage(1);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => selectFilter(f.key)}
              className={cn(
                "rounded px-3 py-1 text-sm transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          placeholder="Search projects…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
      </div>

      {isError ? (
        <p className="text-sm text-destructive">
          {error?.message ?? "Failed to load projects."}
        </p>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : data.projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            No projects yet. Create your first one.
          </p>
          <div className="mt-4 flex justify-center">
            <CreateProjectDialog />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.projects.map((p) => (
              <ProjectCard key={p.id} project={p} owner={ownerMap[p.ownerId]} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
