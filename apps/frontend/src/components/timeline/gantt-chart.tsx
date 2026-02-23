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
import styles from "./gantt-chart.module.css";

interface GanttChartProps {
  projectId: string;
}

export function GanttChart({ projectId }: GanttChartProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { data: modules, isLoading: modulesLoading } = useModules(projectId);
  const { data: allTasks, isLoading: tasksLoading } = useTasks({});

  if (modulesLoading || tasksLoading) {
    return (
      <div className={styles.loadingContainer}>
        <Skeleton className={styles.loadingHeader} />
        <Skeleton className={styles.loadingBody} />
      </div>
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <p className={styles.emptyMessage}>
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
      className={styles.scrollContainer}
      style={{ height: "calc(100vh - 200px)", width: "calc(100vw - 255px - 50px)" }}
    >
      <div style={{ width: totalWidth + taskPanelWidth }}>
        <div
          className={styles.gridLayout}
          style={{ gridTemplateColumns: `${taskPanelWidth}px 1fr` }}
        >
          <div className={styles.taskPanelColumn}>
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
