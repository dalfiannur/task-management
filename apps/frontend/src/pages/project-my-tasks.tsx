import { useParams, useSearchParams } from "react-router";
import { useOutletContext } from "react-router";
import { useProject } from "@/hooks/use-projects";
import { useModules } from "@/hooks/use-modules";
import { useMe } from "@/hooks/use-me";
import { ModuleSection } from "@/components/modules/module-section";
import { TaskFilters } from "@/components/tasks/task-filters";
import { Search, CircleDot } from "lucide-react";
import { getDisplayStatus } from "@/types/project";
import type { ProjectLayoutContext } from "./project-layout";
import styles from "./project-detail.module.css";

export function Component() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subProjectCountsByModule } = useOutletContext<ProjectLayoutContext>();
  const { data: me } = useMe();

  const status = searchParams.get("status") ?? undefined;
  const priority = searchParams.get("priority") ?? undefined;
  const search = searchParams.get("search") ?? undefined;

  const { data: project } = useProject(projectId!);
  const { data: modules } = useModules(projectId);

  if (!project || !me) {
    return null;
  }

  return (
    <div>
      {/* Filters Row */}
      <div className={styles.filtersRow}>
        <TaskFilters filters={{ status, priority }} />
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            placeholder="Search tasks..."
            value={search ?? ""}
            onChange={(e) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("search", e.target.value);
                else next.delete("search");
                return next;
              })
            }
            className="rounded-full border border-gray-200 bg-white pl-8 pr-3.5 h-7 text-sm leading-5 w-[220px] transition-colors placeholder:text-muted-foreground/60 focus:outline-none focus:border-gray-300"
          />
        </div>
      </div>

      {/* Module List */}
      <div className={styles.moduleList}>
        {modules?.map((mod, index) => (
          <div
            key={mod.id}
            className={styles.moduleItem}
            style={{ animationDelay: `${index * 75 + 200}ms` }}
          >
            <div className={styles.moduleItemContent}>
              <ModuleSection
                module={mod}
                projectId={projectId!}
                colorIndex={index}
                filters={{ status, priority, search, assignees: [me.id] }}
                projectStatus={getDisplayStatus(project)}
                subProjectCount={subProjectCountsByModule.get(mod.id) ?? 0}
              />
            </div>
          </div>
        ))}
      </div>
      {modules?.length === 0 && (
        <div className={styles.emptyState}>
          <CircleDot className={styles.emptyIcon} />
          <div className={styles.emptyText}>
            <p className={styles.emptyTitle}>No modules yet</p>
            <p className={styles.emptySubtitle}>
              Modules will appear here once created in All Tasks.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
