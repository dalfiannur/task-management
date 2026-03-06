import { useState, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useMyTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import {
  TASK_STATUS_CONFIG,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
} from "@/types/task";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ListChecks } from "lucide-react";
import { useCompanyStore } from "@/stores/company-store";
import styles from "./my-tasks.module.css";

export function Component() {
  const { data: myTasksData, isLoading: tasksLoading } = useMyTasks();
  const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
  const { data: projects, isLoading: projectsLoading } = useProjects(selectedCompanyId ? { ownerId: selectedCompanyId } : undefined);
  const updateTask = useUpdateTask();

  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const priorityFilter = searchParams.get("priority") ?? "all";
  const searchQuery = searchParams.get("q") ?? "";

  const [selectedTask, setSelectedTask] = useState<{
    taskId: string;
    projectId: string;
    moduleId: string;
  } | null>(null);

  const isLoading = tasksLoading || projectsLoading;

  const tasks = myTasksData?.tasks;
  const moduleMap = myTasksData?.moduleMap ?? {};
  const projectCoreRefMap = myTasksData?.projectCoreRefMap ?? {};

  // Build project lookup by core ID
  const projectMap = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, p])),
    [projects],
  );

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter)
        return false;
      if (
        searchQuery &&
        !task.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    });
  }, [tasks, statusFilter, priorityFilter, searchQuery]);

  function setFilter(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "all" || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className={styles.skeletonPage}>
        <div>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <div className={styles.filtersRow}>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-60" />
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageSpacing}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>My Tasks</h1>
          <p className={styles.headerSubtitle}>
            {filteredTasks.length}{" "}
            {filteredTasks.length === 1 ? "task" : "tasks"}
          </p>
        </div>

        {/* Filters */}
        <div className={styles.filtersRow} style={{ animationDelay: "75ms" }}>
          <Select
            value={statusFilter}
            onValueChange={(v) => setFilter("status", v)}
          >
            <SelectTrigger className={styles.filterSelect}>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(
                Object.entries(TASK_STATUS_CONFIG) as [
                  TaskStatus,
                  { label: string; color: string },
                ][]
              ).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  <span className={config.color}>{config.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={priorityFilter}
            onValueChange={(v) => setFilter("priority", v)}
          >
            <SelectTrigger className={styles.filterSelect}>
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="none">No priority</SelectItem>
            </SelectContent>
          </Select>

          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setFilter("q", e.target.value)}
            className={styles.searchInput}
          />
        </div>

        {/* Tasks */}
        {filteredTasks.length === 0 ? (
          <div className={styles.emptyState} style={{ animationDelay: "150ms" }}>
            <ListChecks className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No tasks found</p>
            <p className={styles.emptyDesc}>
              {statusFilter !== "all" || priorityFilter !== "all" || searchQuery
                ? "Try adjusting your filters"
                : "You have no assigned tasks in active projects"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => {
                const mod = moduleMap[task.moduleId];
                const localProjectId = mod?.projectId ?? "";
                const coreProjectId = projectCoreRefMap[localProjectId];
                const project = coreProjectId
                  ? projectMap.get(coreProjectId)
                  : undefined;

                return (
                  <TaskRow
                    key={task.id}
                    task={task}
                    moduleName={mod?.name ?? "Unknown Module"}
                    projectName={
                      project ? getProjectDisplayName(project) : undefined
                    }
                    onSelect={() =>
                      setSelectedTask({
                        taskId: task.id,
                        projectId: localProjectId,
                        moduleId: task.moduleId,
                      })
                    }
                    onStatusChange={(id, input) =>
                      updateTask.mutate({ id, input })
                    }
                  />
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Task detail dialog */}
      {selectedTask && (
        <TaskDetail
          taskId={selectedTask.taskId}
          projectId={selectedTask.projectId}
          moduleId={selectedTask.moduleId}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  moduleName,
  projectName,
  onSelect,
  onStatusChange,
}: {
  task: Task;
  moduleName: string;
  projectName?: string;
  onSelect: () => void;
  onStatusChange: (id: string, input: UpdateTaskInput) => void;
}) {
  return (
    <TableRow
      className={styles.taskRow}
      onClick={onSelect}
    >
      <TableCell>
        <span className={styles.moduleTag}>
          {projectName ? `${projectName} / ` : ""}
          {moduleName}
        </span>
      </TableCell>
      <TableCell className={styles.taskTitle}>{task.title}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Select
          value={task.status}
          onValueChange={(v) => {
            const newStatus = v as TaskStatus;
            const input: UpdateTaskInput = { status: newStatus };
            if (newStatus === "in_progress" && !task.startDate) {
              input.startDate = new Date().toISOString();
            }
            onStatusChange(task.id, input);
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
            {(
              Object.entries(TASK_STATUS_CONFIG) as [
                TaskStatus,
                { label: string; color: string },
              ][]
            ).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                <span className={config.color}>{config.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <TaskPriorityBadge priority={task.priority} />
      </TableCell>
      <TableCell className={styles.dueDateCell}>
        {task.dueDate
          ? new Date(task.dueDate).toLocaleDateString()
          : "\u2014"}
      </TableCell>
    </TableRow>
  );
}
