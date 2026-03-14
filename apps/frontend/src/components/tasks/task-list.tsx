import { useNavigate } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskPriorityBadge } from "./task-priority-badge";
import { TaskFilters } from "./task-filters";
import { useState, useRef } from "react";
import {
  SearchDropdown,
  type SearchDropdownOption,
} from "@/components/shared/search-dropdown";
import { useTasks, useUpdateTask } from "@/hooks/use-tasks";
import { TASK_STATUS_CONFIG, type TaskStatus, type UpdateTaskInput } from "@/types/task";
import { cn } from "@/lib/utils";
import styles from "./task-list.module.css";

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
  done: "bg-emerald-400",
  cancelled: "bg-red-400",
};

const statusOptions: (SearchDropdownOption & { _key: TaskStatus })[] =
  (Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]).map(
    ([key, config]) => ({ value: key, label: config.label, _key: key }),
  );

function InlineStatusSelect({
  taskId,
  status,
  startDate,
  updateTask,
}: {
  taskId: string;
  status: TaskStatus;
  startDate?: string;
  updateTask: ReturnType<typeof useUpdateTask>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "h-auto rounded-full border-transparent py-0.5 px-2 text-sm leading-4 font-medium font-mono w-fit shadow-none inline-flex items-center",
          TASK_STATUS_CONFIG[status].color,
        )}
      >
        {TASK_STATUS_CONFIG[status].label}
      </button>
      <SearchDropdown
        open={open}
        onClose={() => setOpen(false)}
        containerRef={containerRef}
        options={statusOptions}
        isSelected={(o) => o.value === status}
        onSelect={(o) => {
          const newStatus = o._key;
          const input: UpdateTaskInput = { status: newStatus };
          if (newStatus === "in_progress" && !startDate) {
            input.startDate = new Date().toISOString();
          }
          updateTask.mutate({ id: taskId, input });
          setOpen(false);
        }}
        filterLocally
        renderOption={(o) => (
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full shrink-0", STATUS_DOT_COLORS[o._key])} />
            {o.label}
          </div>
        )}
        width="w-[180px]"
      />
    </div>
  );
}

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
                  <InlineStatusSelect
                    taskId={task.id}
                    status={task.status}
                    startDate={task.startDate}
                    updateTask={updateTask}
                  />
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
