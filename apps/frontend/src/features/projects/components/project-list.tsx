import { useState } from "react";
import { useAtom } from "jotai";
import {
  FolderPlus,
  FolderSearch,
  LayoutGrid,
  List,
  Search,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/users";
import { useProjects } from "../api/hooks";
import { projectsViewAtom, type ProjectsView } from "../atoms/view";
import type { ProjectStatus } from "../types";
import { ProjectCard } from "./project-card";
import { ProjectRow, ProjectRowHeader } from "./project-row";
import { CreateProjectDialog } from "./create-project-dialog";

type Filter = ProjectStatus | "all";

const FILTERS: { key: Filter; label: string; statuses: ProjectStatus[] }[] = [
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "all", label: "All", statuses: [] },
];

const VIEWS: { key: ProjectsView; label: string; icon: typeof List }[] = [
  { key: "grid", label: "Grid view", icon: LayoutGrid },
  { key: "list", label: "List view", icon: List },
];

const GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

/** Pill-in-a-trough segmented control, shared by the status and view pickers. */
const segment = (on: boolean) =>
  cn(
    "rounded-full text-sm",
    "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
    on
      ? "bg-surface-raised font-medium text-text shadow-1"
      : "text-text-muted hover:text-text",
  );

export function ProjectList() {
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useAtom(projectsViewAtom);

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
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-text-muted">
            {isLoading || isError ? (
              "\u00a0"
            ) : (
              <>
                <span className="text-num">{data.total}</span>{" "}
                {filter === "all" ? "" : `${filter} `}
                {data.total === 1 ? "project" : "projects"}
                {searching && <> matching “{search.trim()}”</>}
              </>
            )}
          </p>
        </div>
        <CreateProjectDialog />
      </header>

      {/* Filter dan search hanya tampil kalau ada yang bisa dioperasikan, atau
          kalau salah satunya memang sedang menyaring — empty-states.md §3.
          Saat layar benar-benar kosong keduanya kontrol mati yang menutupi CTA. */}
      {showControls && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Filter by status"
            className="inline-flex gap-1 overflow-x-auto rounded-full bg-surface-sunken p-[3px]"
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => selectFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(segment(filter === f.key), "px-3 py-1")}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative order-last w-full sm:order-none sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
            <Input
              type="search"
              placeholder="Search projects…"
              aria-label="Search projects"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="!pl-8" /* beats the module's padding shorthand */
            />
          </div>
          <div
            role="group"
            aria-label="Layout"
            className="ml-auto inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]"
          >
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                aria-pressed={view === key}
                aria-label={label}
                title={label}
                className={cn(segment(view === key), "p-1.5")}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      )}

      {isError ? (
        <p className="text-sm text-danger">
          {error?.message ?? "Failed to load projects."}
        </p>
      ) : isLoading ? (
        view === "grid" ? (
          <div className={GRID}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <Skeleton className="h-96 w-full rounded-xl" />
        )
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
          {view === "grid" ? (
            <div className={GRID}>
              {data.projects.map((p) => (
                <ProjectCard key={p.id} project={p} owner={ownerMap[p.ownerId]} />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
              <ProjectRowHeader />
              <ul>
                {data.projects.map((p) => (
                  <ProjectRow key={p.id} project={p} owner={ownerMap[p.ownerId]} />
                ))}
              </ul>
            </div>
          )}
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
