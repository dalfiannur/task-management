import { Badge } from "@/components/ui/badge";
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/types/task";

interface TaskStatusBadgeProps {
  status: TaskStatus;
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const config = TASK_STATUS_CONFIG[status];
  return (
    <Badge variant="secondary" className={config.color}>
      {config.label}
    </Badge>
  );
}
