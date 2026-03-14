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
    <div ref={setNodeRef} style={style} className="flex items-start animate-in fade-in slide-in-from-bottom-2">
      <button
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground touch-none bg-transparent border-none pt-2 pr-1 shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="flex-1 min-w-0">
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
      <div className="px-5 py-2.5 border-b flex items-center gap-2.5">
        <TaskFilters projectId={projectId} filters={{ status, priority, assignees }} />
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
        {getDisplayStatus(project) === "active" && (
          <Button
            size="sm"
            className="shrink-0"
            onClick={openModuleForm}
          >
            <Plus className="size-3.5 mr-1" />
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
            <div className="p-5 space-y-3">
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
        <div className="flex flex-col items-center gap-2.5 py-16 text-muted-foreground">
          <CircleDot className="size-7 text-muted-foreground/30" />
          <div className="text-center">
            <p className="font-medium">No modules yet</p>
            <p className="text-sm leading-5 text-muted-foreground/70 mt-0.5">
              Create a module to start organizing tasks.
            </p>
          </div>
          {getDisplayStatus(project) === "active" && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={openModuleForm}
            >
              <Plus className="size-3.5 mr-1.5" />
              Create Module
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
