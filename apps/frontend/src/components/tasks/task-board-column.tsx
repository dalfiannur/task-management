import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TaskCard } from "./task-card";
import { TASK_STATUS_CONFIG, type Task, type TaskStatus, type Label } from "@/types/task";
import { useNavigate, useParams } from "@tanstack/react-router";

interface TaskBoardColumnProps {
  status: TaskStatus;
  tasks: Task[];
  labels?: Label[];
}

export function TaskBoardColumn({ status, tasks, labels }: TaskBoardColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });
  const config = TASK_STATUS_CONFIG[status];
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const projectId = (params as { projectId?: string }).projectId;

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center gap-2 px-2 py-3">
        <h3 className="text-sm font-semibold">{config.label}</h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex-1 space-y-2 p-1 min-h-[200px] rounded-lg bg-muted/30"
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              labels={labels}
              onClick={() => {
                if (projectId) {
                  navigate({
                    to: "/projects/$projectId",
                    params: { projectId },
                  });
                }
              }}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
