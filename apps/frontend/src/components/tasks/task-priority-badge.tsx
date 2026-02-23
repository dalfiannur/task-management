import {
  Minus,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
} from "lucide-react";
import { TASK_PRIORITY_CONFIG, type TaskPriority } from "@/types/task";
import styles from "./task-priority-badge.module.css";

const ICONS = {
  Minus,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
} as const;

interface TaskPriorityBadgeProps {
  priority: TaskPriority;
}

export function TaskPriorityBadge({ priority }: TaskPriorityBadgeProps) {
  const config = TASK_PRIORITY_CONFIG[priority];
  const Icon = ICONS[config.icon as keyof typeof ICONS];

  return (
    <span className={`${styles.badge} ${config.color}`}>
      <Icon className={styles.icon} />
      <span>{config.label}</span>
    </span>
  );
}
