import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { TaskBoardColumn } from "./task-board-column";
import { TaskCard } from "./task-card";
import { useTasks, useReorderTask, useUpdateTask } from "@/hooks/use-tasks";
import { useLabels } from "@/hooks/use-labels";
import { BOARD_COLUMNS, type Task, type TaskStatus } from "@/types/task";
import { Skeleton } from "@/components/ui/skeleton";

interface TaskBoardProps {
  filters: {
    moduleId?: string;
    status?: string;
    priority?: string;
    search?: string;
  };
  projectId: string;
  moduleId: string;
}

export function TaskBoard({ filters, projectId }: TaskBoardProps) {
  const { data: tasks, isLoading } = useTasks(filters);
  const { data: labels = [] } = useLabels(projectId);
  const reorderTask = useReorderTask();
  const updateTask = useUpdateTask();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const getTasksByStatus = useCallback(
    (status: TaskStatus) => {
      return (tasks ?? [])
        .filter((t) => t.status === status)
        .sort((a, b) => a.order - b.order);
    },
    [tasks],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks?.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Determine target status (either a column id or a task's column)
    let targetStatus: TaskStatus;
    if (BOARD_COLUMNS.includes(overId as TaskStatus)) {
      targetStatus = overId as TaskStatus;
    } else {
      const overTask = tasks?.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
    }

    const currentTask = tasks?.find((t) => t.id === taskId);
    if (!currentTask) return;
    if (currentTask.status === targetStatus && active.id === over.id) return;

    reorderTask.mutate({
      id: taskId,
      newOrder: currentTask.order,
      newStatus: targetStatus,
    });

    if (targetStatus === "in_progress" && !currentTask.startDate) {
      updateTask.mutate({
        id: taskId,
        input: { startDate: new Date().toISOString() },
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 p-6 overflow-x-auto">
        {BOARD_COLUMNS.map((col) => (
          <div key={col} className="w-72 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-4 p-6 overflow-x-auto h-[calc(100vh-3.5rem)]">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {BOARD_COLUMNS.map((status) => (
          <TaskBoardColumn
            key={status}
            status={status}
            tasks={getTasksByStatus(status)}
            labels={labels}
          />
        ))}
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} labels={labels} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
