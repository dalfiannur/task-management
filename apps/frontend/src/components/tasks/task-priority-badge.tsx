import {
  Minus,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
} from "lucide-react";
import { TASK_PRIORITY_CONFIG, type TaskPriority } from "@/types/task";

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
    <span className={`inline-flex items-center gap-1 text-sm ${config.color}`}>
      <Icon className="size-4" />
      <span>{config.label}</span>
    </span>
  );
}
