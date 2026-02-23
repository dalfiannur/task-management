import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TaskCard } from "./task-card";
import { TASK_STATUS_CONFIG, type Task, type TaskStatus, type Label } from "@/types/task";
import { useNavigate, useParams } from "react-router";
import styles from "./task-board-column.module.css";

interface TaskBoardColumnProps {
  status: TaskStatus;
  tasks: Task[];
  labels?: Label[];
}

export function TaskBoardColumn({ status, tasks, labels }: TaskBoardColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });
  const config = TASK_STATUS_CONFIG[status];
  const navigate = useNavigate();
  const params = useParams();
  const projectId = (params as { projectId?: string }).projectId;

  return (
    <div className={styles.column}>
      <div className={styles.header}>
        <h3 className={styles.headerTitle}>{config.label}</h3>
        <span className={styles.headerCount}>
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={styles.dropZone}
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
                  navigate(`/projects/${projectId}`);
                }
              }}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
