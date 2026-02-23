import { useParams, useSearchParams } from "react-router";
import { useOutletContext } from "react-router";
import { useProject, useSubProjects } from "@/hooks/use-projects";
import { useModules } from "@/hooks/use-modules";
import { ModuleSection } from "@/components/modules/module-section";
import { TaskFilters } from "@/components/tasks/task-filters";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/projects/project-card";
import { Plus, Search, CircleDot, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ProjectLayoutContext } from "./project-layout";
import styles from "./project-detail.module.css";

export function Component() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openModuleForm } = useOutletContext<ProjectLayoutContext>();

  const status = searchParams.get("status") ?? undefined;
  const priority = searchParams.get("priority") ?? undefined;
  const search = searchParams.get("search") ?? undefined;

  const { data: project } = useProject(projectId!);
  const { data: modules } = useModules(projectId);
  const { data: subProjects } = useSubProjects(projectId);
  const [subProjectsExpanded, setSubProjectsExpanded] = useState(true);

  if (!project) {
    return null;
  }

  return (
    <div>
      {/* Sub-Projects */}
      {subProjects && subProjects.length > 0 && (
        <div className={styles.subProjectsSection}>
          <button
            type="button"
            className={styles.subProjectsToggle}
            onClick={() => setSubProjectsExpanded((v) => !v)}
          >
            <ChevronRight
              className={cn(
                styles.chevronIcon,
                subProjectsExpanded && styles.chevronExpanded,
              )}
            />
            Sub-Projects
            <span className={styles.subProjectsCount}>
              ({subProjects.length})
            </span>
          </button>
          {subProjectsExpanded && (
            <div className={styles.subProjectsGrid}>
              {subProjects.map((sub) => (
                <ProjectCard key={sub.id} project={sub} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters Row */}
      <div className={styles.filtersRow}>
        <TaskFilters filters={{ status, priority }} />
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} />
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
            className={styles.searchInput}
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
            <ModuleSection
              module={mod}
              projectId={projectId!}
              colorIndex={index}
              filters={{ status, priority, search }}
              projectStatus={project.status.value}
            />
          </div>
        ))}
      </div>
      {modules?.length === 0 && (
        <div className={styles.emptyState}>
          <CircleDot className={styles.emptyIcon} />
          <div className={styles.emptyText}>
            <p className={styles.emptyTitle}>No modules yet</p>
            <p className={styles.emptySubtitle}>
              Create a module to start organizing tasks.
            </p>
          </div>
          {project.status.value === "on_going" && (
            <Button
              size="sm"
              variant="outline"
              className={styles.emptyBtn}
              onClick={openModuleForm}
            >
              <Plus className={styles.emptyBtnIcon} />
              Create Module
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
