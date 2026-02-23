import { Card, CardContent } from "@/components/ui/card";
import { TaskPriorityBadge } from "./task-priority-badge";
import type { Task, Label } from "@/types/task";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import styles from "./task-card.module.css";

interface TaskCardProps {
  task: Task;
  labels?: Label[];
  onClick?: () => void;
}

export function TaskCard({ task, labels = [], onClick }: TaskCardProps) {
  const taskLabels = labels.filter((l) => task.labelIds.includes(l.id));
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={styles.card}
      onClick={onClick}
    >
      <CardContent className={styles.cardContent}>
        <div className={styles.row}>
          <button
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
          >
            <GripVertical className={styles.dragIcon} />
          </button>
          <div className={styles.content}>
            <p className={styles.title}>{task.title}</p>
            <div className={styles.meta}>
              <TaskPriorityBadge priority={task.priority} />
              {taskLabels.map((label) => (
                <span
                  key={label.id}
                  className={styles.label}
                >
                  <span
                    className={styles.labelDot}
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
