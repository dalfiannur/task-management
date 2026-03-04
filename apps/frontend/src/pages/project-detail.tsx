import { useParams, useSearchParams } from "react-router";
import { useOutletContext } from "react-router";
import { useState } from "react";
import { useProject } from "@/hooks/use-projects";
import { useModules, useReorderModules } from "@/hooks/use-modules";
import { ModuleSection } from "@/components/modules/module-section";
import { TaskFilters } from "@/components/tasks/task-filters";
import { Button } from "@/components/ui/button";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Search, CircleDot, GripVertical } from "lucide-react";
import type { Module } from "@/types/task";
import type { ProjectDisplayStatus } from "@/types/project";
import { getDisplayStatus } from "@/types/project";
import type { ProjectLayoutContext } from "./project-layout";
import styles from "./project-detail.module.css";

function SortableModuleItem({
  module: mod,
  projectId,
  colorIndex,
  filters,
  projectStatus,
  subProjectCount,
}: {
  module: Module;
  projectId: string;
  colorIndex: number;
  filters: { status?: string; priority?: string; search?: string; assignees?: string[] };
  projectStatus: ProjectDisplayStatus;
  subProjectCount: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: mod.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.moduleItem}>
      <button
        className={styles.moduleDragHandle}
        {...attributes}
        {...listeners}
      >
        <GripVertical className={styles.moduleDragIcon} />
      </button>
      <div className={styles.moduleItemContent}>
        <ModuleSection
          module={mod}
          projectId={projectId}
          colorIndex={colorIndex}
          filters={filters}
          projectStatus={projectStatus}
          subProjectCount={subProjectCount}
        />
      </div>
    </div>
  );
}

export function Component() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openModuleForm, subProjectCountsByModule } = useOutletContext<ProjectLayoutContext>();

  const status = searchParams.get("status") ?? undefined;
  const priority = searchParams.get("priority") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const assigneeParam = searchParams.get("assignee");
  const assignees = assigneeParam ? assigneeParam.split(",") : undefined;

  const { data: project } = useProject(projectId!);
  const { data: modules } = useModules(projectId);
  const reorderModules = useReorderModules();
  const [orderedModules, setOrderedModules] = useState<Module[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const displayModules = orderedModules ?? modules ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayModules.findIndex((m) => m.id === active.id);
    const newIndex = displayModules.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayModules, oldIndex, newIndex);
    setOrderedModules(reordered);
    reorderModules.mutate(
      { projectId: projectId!, moduleIds: reordered.map((m) => m.id) },
      { onSuccess: () => setOrderedModules(null) },
    );
  };

  if (!project) {
    return null;
  }

  return (
    <div>
      {/* Filters Row */}
      <div className={styles.filtersRow}>
        <TaskFilters projectId={projectId} filters={{ status, priority, assignees }} />
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
        {project.status === "active" && (
          <Button
            size="sm"
            className={styles.newModuleBtn}
            onClick={openModuleForm}
          >
            <Plus className={styles.newModuleBtnIcon} />
            New Module
          </Button>
        )}
      </div>

      {/* Module List */}
      {displayModules.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayModules.map((m) => m.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={styles.moduleList}>
              {displayModules.map((mod, index) => (
                <SortableModuleItem
                  key={mod.id}
                  module={mod}
                  projectId={projectId!}
                  colorIndex={index}
                  filters={{ status, priority, search, assignees }}
                  projectStatus={getDisplayStatus(project)}
                  subProjectCount={subProjectCountsByModule.get(mod.id) ?? 0}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className={styles.emptyState}>
          <CircleDot className={styles.emptyIcon} />
          <div className={styles.emptyText}>
            <p className={styles.emptyTitle}>No modules yet</p>
            <p className={styles.emptySubtitle}>
              Create a module to start organizing tasks.
            </p>
          </div>
          {project.status === "active" && (
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
