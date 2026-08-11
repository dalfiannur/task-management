import { useState } from "react";
import { FolderPlus, FolderSearch, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
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

  const isEmpty = !isLoading && !isError && data.projects.length === 0;
  const searching = search.trim().length > 0;
  const filtered = filter !== "all";
  // Kontrol yang sedang menyaring tetap tampil saat hasil nol supaya bisa
  // dicabut; kalau tidak ada yang menyaring, ia disembunyikan.
  const showControls = !isEmpty || searching || filtered;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>

      {/* Filter dan search hanya tampil kalau ada yang bisa dioperasikan, atau
          kalau salah satunya memang sedang menyaring — empty-states.md §3.
          Saat layar benar-benar kosong keduanya kontrol mati yang menutupi CTA. */}
      {showControls && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => selectFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm",
                  "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                  filter === f.key
                    ? "bg-surface-raised font-medium text-text shadow-1"
                    : "text-text-muted hover:text-text",
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
      )}

      {isError ? (
        <p className="text-sm text-danger">
          {error?.message ?? "Failed to load projects."}
        </p>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : isEmpty ? (
        // Tiga sebab kosong, tiga copy dan tiga CTA — empty-states.md §4.
        // Yang dicari user saat hasil nol adalah jalan keluar dari filternya,
        // bukan tombol "buat baru".
        searching ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title={`No projects match “${search}”`}
            body="Try a shorter search term, or clear it to see the full list again."
            action={{
              label: "Clear search",
              onClick: () => {
                setSearch("");
                setPage(1);
              },
            }}
          />
        ) : filtered ? (
          <EmptyState
            variant="no-results"
            icon={FolderSearch}
            title={`No ${filter} projects`}
            body="Nothing sits in this status right now. Other projects may be under a different one."
            action={{
              label: "Show all projects",
              onClick: () => selectFilter("all"),
            }}
          />
        ) : (
          <EmptyState
            icon={FolderPlus}
            title="No projects yet"
            body="A project holds your tasks, timeline, files, and the people working on it — all in one place."
            actionSlot={<CreateProjectDialog />}
          />
        )
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
              <span className="text-sm text-text-muted">
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
