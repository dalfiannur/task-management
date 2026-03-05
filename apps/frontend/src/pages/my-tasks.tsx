import { useState, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useMe } from "@/hooks/use-me";
import { useAllTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useAllModules } from "@/hooks/use-modules";
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
import { ChevronRight, ListChecks } from "lucide-react";
import styles from "./my-tasks.module.css";

interface ProjectGroup {
  projectId: string;
  projectName: string;
  tasks: (Task & { moduleName: string })[];
}

export function Component() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: tasks, isLoading: tasksLoading } = useAllTasks(
    { assigneeId: me?.id },
    { skip: !me?.id },
  );
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: modules, isLoading: modulesLoading } = useAllModules();
  const updateTask = useUpdateTask();

  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const priorityFilter = searchParams.get("priority") ?? "all";
  const searchQuery = searchParams.get("q") ?? "";

  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [selectedTask, setSelectedTask] = useState<{
    taskId: string;
    projectId: string;
    moduleId: string;
  } | null>(null);

  const isLoading = meLoading || tasksLoading || projectsLoading || modulesLoading;

  // Build lookup maps and group tasks by project
  const projectGroups = useMemo(() => {
    if (!tasks || !modules) return [];

    // Module lookup: moduleId → { name, projectId }
    const moduleMap = new Map(
      modules.map((m) => [m.id, { name: m.name, projectId: m.projectId }]),
    );

    // Project lookup by Core Portal ID
    const projectMap = new Map(
      (projects ?? []).map((p) => [p.id, p]),
    );

    // Apply user filters (assignee already filtered server-side)
    const filtered = tasks.filter((task) => {
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

    // Group by project
    const groups = new Map<string, ProjectGroup>();
    for (const task of filtered) {
      const mod = moduleMap.get(task.moduleId);
      const projectId = mod?.projectId ?? "unknown";
      const project = projectMap.get(projectId);
      const projectName = project
        ? getProjectDisplayName(project)
        : "Other";

      if (!groups.has(projectId)) {
        groups.set(projectId, { projectId, projectName, tasks: [] });
      }
      groups.get(projectId)!.tasks.push({
        ...task,
        moduleName: mod?.name ?? "Unknown",
      });
    }

    const result = Array.from(groups.values());
    result.sort((a, b) => a.projectName.localeCompare(b.projectName));
    return result;
  }, [tasks, modules, projects, statusFilter, priorityFilter, searchQuery]);

  const totalTasks = projectGroups.reduce((s, g) => s + g.tasks.length, 0);
  const projectCount = projectGroups.length;

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

  function toggleCollapse(projectId: string) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
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
            {totalTasks} {totalTasks === 1 ? "task" : "tasks"} across{" "}
            {projectCount} {projectCount === 1 ? "project" : "projects"}
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

        {/* Task groups */}
        {projectGroups.length === 0 ? (
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
          projectGroups.map((group, gi) => {
            const collapsed = collapsedProjects.has(group.projectId);
            return (
              <div
                key={group.projectId}
                className={styles.projectGroup}
                style={{ animationDelay: `${gi * 50 + 150}ms` }}
              >
                <div
                  className={styles.projectGroupHeader}
                  onClick={() => toggleCollapse(group.projectId)}
                >
                  <ChevronRight
                    className={cn(
                      styles.chevron,
                      !collapsed && styles.chevronOpen,
                    )}
                  />
                  <span className={styles.projectName}>
                    {group.projectName}
                  </span>
                  <span className={styles.taskCount}>
                    {group.tasks.length}{" "}
                    {group.tasks.length === 1 ? "task" : "tasks"}
                  </span>
                </div>
                {!collapsed && (
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
                      {group.tasks.map((task) => (
                        <TableRow
                          key={task.id}
                          className={styles.taskRow}
                          onClick={() =>
                            setSelectedTask({
                              taskId: task.id,
                              projectId: group.projectId,
                              moduleId: task.moduleId,
                            })
                          }
                        >
                          <TableCell>
                            <span className={styles.moduleTag}>
                              {task.moduleName}
                            </span>
                          </TableCell>
                          <TableCell className={styles.taskTitle}>
                            {task.title}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Select
                              value={task.status}
                              onValueChange={(v) => {
                                const newStatus = v as TaskStatus;
                                const input: UpdateTaskInput = {
                                  status: newStatus,
                                };
                                if (
                                  newStatus === "in_progress" &&
                                  !task.startDate
                                ) {
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
                                {(
                                  Object.entries(TASK_STATUS_CONFIG) as [
                                    TaskStatus,
                                    { label: string; color: string },
                                  ][]
                                ).map(([key, config]) => (
                                  <SelectItem key={key} value={key}>
                                    <span className={config.color}>
                                      {config.label}
                                    </span>
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
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })
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
