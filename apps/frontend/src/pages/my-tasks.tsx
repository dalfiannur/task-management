import { useState, useRef, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useMyTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { SearchSelect } from "@/components/shared/search-select";
import {
  SearchDropdown,
  type SearchDropdownOption,
} from "@/components/shared/search-dropdown";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type Task,
  type TaskStatus,
  type TaskPriority,
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
import { Pagination } from "@/components/shared/pagination";
import { cn } from "@/lib/utils";
import { ListChecks, Search } from "lucide-react";
import { useCompanyStore } from "@/stores/company-store";
import styles from "./my-tasks.module.css";

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
  done: "bg-emerald-400",
  cancelled: "bg-red-400",
};

const statusOptions: (SearchDropdownOption & { _key: TaskStatus })[] = (
  Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]
).map(([key, config]) => ({ value: key, label: config.label, _key: key }));

const statusFilterOptions = [
  { value: "all", label: "All statuses" },
  ...statusOptions.map((o) => ({ value: o.value, label: o.label })),
];

const priorityFilterOptions = [
  { value: "all", label: "All priorities" },
  ...(
    Object.entries(TASK_PRIORITY_CONFIG) as [TaskPriority, { label: string }][]
  ).map(([key, config]) => ({ value: key, label: config.label })),
];

export function Component() {
  const [page, setPage] = useState(1);
  const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);

  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const priorityFilter = searchParams.get("priority") ?? "all";
  const searchQuery = searchParams.get("q") ?? "";

  const { data: myTasksData, isLoading: tasksLoading, pageInfo } = useMyTasks({
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    page,
  });
  const { data: projects, isLoading: projectsLoading } = useProjects(selectedCompanyId ? { ownerId: selectedCompanyId } : undefined);
  const updateTask = useUpdateTask();

  const [selectedTask, setSelectedTask] = useState<{
    taskId: string;
    projectId: string;
    moduleId: string;
  } | null>(null);

  const isLoading = tasksLoading || projectsLoading;

  const tasks = myTasksData?.tasks;
  const moduleMap = myTasksData?.moduleMap ?? {};
  const projectCoreRefMap = myTasksData?.projectCoreRefMap ?? {};

  const projectMap = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, p])),
    [projects],
  );

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    if (!searchQuery) return tasks;
    return tasks.filter((task) =>
      task.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [tasks, searchQuery]);

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
    setPage(1);
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
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>My Tasks</h1>
          <p className={styles.headerSubtitle}>
            {filteredTasks.length}{" "}
            {filteredTasks.length === 1 ? "task" : "tasks"}
          </p>
        </div>

        <div className={styles.filtersRow} style={{ animationDelay: "75ms" }}>
          <SearchSelect
            options={statusFilterOptions}
            value={statusFilter}
            onChange={(v) => setFilter("status", v ?? "all")}
            getOptionValue={(o) => o.value}
            getOptionLabel={(o) => o.label}
            filterLocally
            clearable={false}
            variant="pill"
            placeholder="All statuses"
            className="w-[10rem]"
          />

          <SearchSelect
            options={priorityFilterOptions}
            value={priorityFilter}
            onChange={(v) => setFilter("priority", v ?? "all")}
            getOptionValue={(o) => o.value}
            getOptionLabel={(o) => o.label}
            filterLocally
            clearable={false}
            variant="pill"
            placeholder="All priorities"
            className="w-[10rem]"
          />

          <div className="relative flex-1 min-w-[12rem] max-w-[20rem]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setFilter("q", e.target.value)}
              className="w-full rounded-full border border-border bg-background pl-8 pr-3.5 h-8 text-sm transition-colors placeholder:text-muted-foreground/60 focus:outline-none focus:border-border/80"
            />
          </div>
        </div>

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
                        projectId: coreProjectId ?? localProjectId,
                        moduleId: task.moduleId,
                      })
                    }
                    updateTask={updateTask}
                  />
                );
              })}
            </TableBody>
          </Table>
        )}

        {filteredTasks.length > 0 && pageInfo && (pageInfo.hasNextPage || pageInfo.page > 1) && (
          <Pagination
            currentPage={pageInfo.page}
            hasNextPage={pageInfo.hasNextPage}
            onPageChange={setPage}
          />
        )}
      </div>

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
  updateTask,
}: {
  task: Task;
  moduleName: string;
  projectName?: string;
  onSelect: () => void;
  updateTask: ReturnType<typeof useUpdateTask>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={cn(
              "font-mono h-auto rounded-full border-transparent px-2 py-0.5 text-sm leading-4 font-medium w-fit shadow-none inline-flex items-center",
              TASK_STATUS_CONFIG[task.status].color,
            )}
          >
            {TASK_STATUS_CONFIG[task.status].label}
          </button>
          <SearchDropdown
            open={open}
            onClose={() => setOpen(false)}
            containerRef={containerRef}
            options={statusOptions}
            isSelected={(o) => o.value === task.status}
            onSelect={(o) => {
              const newStatus = o._key;
              const input: UpdateTaskInput = { status: newStatus };
              if (newStatus === "in_progress" && !task.startDate) {
                input.startDate = new Date().toISOString();
              }
              updateTask.mutate({ id: task.id, input });
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
