import { useRef } from "react";
import { useModules } from "@/hooks/use-modules";
import { useTasks } from "@/hooks/use-tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { GanttTaskPanel } from "./gantt-task-panel";
import { GanttTimelineGrid } from "./gantt-timeline-grid";
import {
  type TimelineRow,
  DAY_WIDTH,
  computeTimelineRange,
} from "./timeline-utils";
import type { Task } from "@/types/task";

interface GanttChartProps {
  projectId: string;
}

export function GanttChart({ projectId }: GanttChartProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { data: modules, isLoading: modulesLoading } = useModules(projectId);
  const { data: allTasks, isLoading: tasksLoading } = useTasks({});

  if (modulesLoading || tasksLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-12">
        No modules to display on the timeline.
      </p>
    );
  }

  const tasksByModule = new Map<string, Task[]>();
  for (const mod of modules) {
    tasksByModule.set(
      mod.id,
      (allTasks ?? []).filter((t) => t.moduleId === mod.id),
    );
  }

  const rows: TimelineRow[] = [];
  modules.forEach((mod, index) => {
    const moduleTasks = tasksByModule.get(mod.id) ?? [];
    rows.push({
      type: "module",
      module: mod,
      taskCount: moduleTasks.length,
      colorIndex: index,
    });
    for (const task of moduleTasks) {
      rows.push({ type: "task", task, colorIndex: index });
    }
  });

  const allTasksList = Array.from(tasksByModule.values()).flat();
  const range = computeTimelineRange(allTasksList);
  const totalWidth = range.days.length * DAY_WIDTH;
  const taskPanelWidth = 300;
  const headerHeight = 56;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto border rounded-lg bg-background max-w-full"
      style={{ height: "calc(100vh - 200px)", width: "calc(100vw - 255px - 50px)" }}
    >
      <div style={{ width: totalWidth + taskPanelWidth }}>
        <div
          className="grid"
          style={{ gridTemplateColumns: `${taskPanelWidth}px 1fr` }}
        >
          <div className="sticky left-0 z-20 bg-background border-r">
            <GanttTaskPanel rows={rows} headerHeight={headerHeight} />
          </div>
          <div style={{ width: totalWidth }}>
            <GanttTimelineGrid
              rows={rows}
              range={range}
              headerHeight={headerHeight}
              scrollContainerRef={scrollRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
