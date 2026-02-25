import { useNavigate } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskPriorityBadge } from "./task-priority-badge";
import { TaskFilters } from "./task-filters";
import { useTasks, useUpdateTask } from "@/hooks/use-tasks";
import { TASK_STATUS_CONFIG, type TaskStatus, type UpdateTaskInput } from "@/types/task";
import { cn } from "@/lib/utils";
import styles from "./task-list.module.css";

interface TaskListProps {
  filters: {
    moduleId?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    label?: string;
    search?: string;
    sort?: string;
    page?: number;
  };
  projectId: string;
  moduleId: string;
}

export function TaskList({ filters, projectId }: TaskListProps) {
  const navigate = useNavigate();
  const { data: tasks, isLoading } = useTasks(filters);
  const updateTask = useUpdateTask();

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.filtersWrapper}>
        <TaskFilters filters={filters} />
      </div>
      <div className={styles.tableWrapper}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]" />
              <TableHead>Title</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[120px]">Priority</TableHead>
              <TableHead className="w-[120px]">Due Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className={styles.emptyCell}>
                  No tasks found
                </TableCell>
              </TableRow>
            )}
            {tasks?.map((task) => (
              <TableRow
                key={task.id}
                className={styles.cursorPointer}
                onClick={() =>
                  navigate(`/projects/${projectId}`)
                }
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox />
                </TableCell>
                <TableCell className={styles.fontMedium}>{task.title}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={task.status}
                    onValueChange={(v) => {
                      const newStatus = v as TaskStatus;
                      const input: UpdateTaskInput = { status: newStatus };
                      if (newStatus === "in_progress" && !task.startDate) {
                        input.startDate = new Date().toISOString();
                      }
                      updateTask.mutate({ id: task.id, input });
                    }}
                  >
                    <SelectTrigger
                      className={cn(
                        styles.statusTrigger,
                        TASK_STATUS_CONFIG[task.status].color,
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]).map(
                        ([key, config]) => (
                          <SelectItem key={key} value={key}>
                            <span className={config.color}>{config.label}</span>
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <TaskPriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell className={styles.mutedText}>
                  {task.dueDate
                    ? new Date(task.dueDate).toLocaleDateString()
                    : "\u2014"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
