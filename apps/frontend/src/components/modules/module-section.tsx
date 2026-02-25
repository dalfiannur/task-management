import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskDetail } from "@/components/tasks/task-detail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useDeleteModule } from "@/hooks/use-modules";
import { useUsers, useUser } from "@/hooks/use-users";
import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { ModuleForm } from "./module-form";
import { TASK_STATUS_CONFIG, type Module, type Task, type TaskStatus, type UpdateTaskInput } from "@/types/task";
import { type ProjectStatus, } from "@/types/project"
import { cn, getInitials } from "@/lib/utils";
import { Button } from "../ui/button";
import s from "./module-section.module.css";

export const MODULE_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#14b8a6", // teal
];

interface ModuleSectionProps {
  module: Module;
  projectId: string;
  colorIndex: number;
  filters?: { status?: string; priority?: string; search?: string };
  projectStatus?: ProjectStatus;
}

function TaskAssigneeCell({ assigneeIds }: { assigneeIds: string[] }) {
  const { data: allUsers = [] } = useUsers();
  const assignedUsers = allUsers.filter((u) => assigneeIds.includes(u.id));

  if (assignedUsers.length === 0) {
    return <span className={s.assigneeDash}>&mdash;</span>;
  }

  if (assignedUsers.length === 1) {
    const user = assignedUsers[0];
    const initials = user.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    return (
      <div className={s.singleAssignee}>
        <Avatar className={s.assigneeAvatar}>
          <AvatarImage src={user.avatarUrl} />
          <AvatarFallback className={s.assigneeFallback}>{initials}</AvatarFallback>
        </Avatar>
        <span className={s.assigneeName}>{user.name}</span>
      </div>
    );
  }

  return (
    <div className={s.multiAssignee}>
      <div className={s.avatarStack}>
        {assignedUsers.slice(0, 3).map((user) => {
          const initials = user.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
          return (
            <Avatar key={user.id} className={s.stackedAvatar}>
              <AvatarImage src={user.avatarUrl} />
              <AvatarFallback className={s.assigneeFallback}>{initials}</AvatarFallback>
            </Avatar>
          );
        })}
      </div>
      {assignedUsers.length > 3 && (
        <span className={s.overflowCount}>+{assignedUsers.length - 3}</span>
      )}
    </div>
  );
}

export function ModuleSection({
  module,
  projectId,
  colorIndex,
  filters,
  projectStatus,
}: ModuleSectionProps) {
  const { data: tasks, isLoading } = useTasks({ moduleId: module.id, ...filters });
  const updateTask = useUpdateTask();
  const deleteModule = useDeleteModule();
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { data: picUser } = useUser(module.picId);
  const color = MODULE_COLORS[colorIndex % MODULE_COLORS.length];

  const taskCount = tasks?.length ?? 0;
  const doneCount = tasks?.filter((t) => t.status === "done").length ?? 0;
  const progressPct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

  return (
    <>
      <Collapsible defaultOpen className="group/module">
        <div
          className={s.container}
          style={{ borderLeftColor: color }}
        >
          <div className={s.headerBar}>
            <CollapsibleTrigger className={s.trigger}>
              <ChevronRight className={s.chevron} />
              <span className={s.moduleName} style={{ color }}>
                {module.name}
              </span>
              <Badge variant="secondary" className={s.countBadge}>
                {isLoading ? "..." : taskCount}
              </Badge>
              {module.description && (
                <span className={s.headerDescription}>{module.description}</span>
              )}
              {!isLoading && taskCount > 0 && (
                <div className={s.progressGroup}>
                  <div className={s.progressTrack}>
                    <div
                      className={s.progressFill}
                      style={{
                        width: `${progressPct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <span className={s.progressText}>
                    {progressPct}%
                  </span>
                </div>
              )}
              {picUser && (
                <span className={s.headerPic}>
                  <Avatar className={s.headerPicAvatar}>
                    <AvatarImage src={picUser.avatarUrl} />
                    <AvatarFallback className={s.assigneeFallback}>
                      {getInitials(picUser.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className={s.headerPicName}>{picUser.name}</span>
                </span>
              )}
            </CollapsibleTrigger>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={s.menuButton}>
                  <MoreHorizontal className={s.menuIcon} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditFormOpen(true)}>
                  <Pencil className={s.menuItemIcon} />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={s.destructiveItem}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className={s.menuItemIcon} />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete module?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the module &quot;{module.name}&quot; and all its tasks.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteModule.mutate(module.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <CollapsibleContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={s.skeletonCell}>Task</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[120px]">Priority</TableHead>
                  <TableHead className="w-[120px]">Due Date</TableHead>
                  <TableHead className="w-[150px]">Assignee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <>
                    {[1, 2].map((i) => (
                      <TableRow key={i}>
                        <TableCell className={s.skeletonCell}>
                          <Skeleton className="h-4 w-40" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}

                {!isLoading && tasks?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className={s.emptyCell}
                    >
                      No tasks in this module
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading &&
                  tasks?.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      updateTask={updateTask}
                      onNavigate={() => setSelectedTaskId(task.id)}
                    />
                  ))}

                {!((projectStatus === "prospect" || projectStatus === "win") && module.name !== "Proposal") && (
                  <TableRow
                    className={s.addTaskRow}
                    onClick={() => setTaskFormOpen(true)}
                  >
                    <TableCell colSpan={5} className={s.addTaskCell}>
                      <span className={s.addTaskLabel}>
                        <Plus className={s.addTaskIcon} />
                        Add task
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <TaskForm
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        moduleId={module.id}
        projectId={projectId}
      />

      <ModuleForm
        open={editFormOpen}
        onOpenChange={setEditFormOpen}
        projectId={projectId}
        module={module}
      />

      {selectedTaskId && (
        <TaskDetail
          taskId={selectedTaskId}
          projectId={projectId}
          moduleId={module.id}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </>
  );
}

function TaskRow({
  task,
  updateTask,
  onNavigate,
}: {
  task: Task;
  updateTask: ReturnType<typeof useUpdateTask>;
  onNavigate: () => void;
}) {
  return (
    <TableRow
      className={s.taskRow}
      onClick={onNavigate}
    >
      <TableCell className={s.taskTitle}>{task.title}</TableCell>
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
              s.statusTrigger,
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
      <TableCell className={s.dueDateCell}>
        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "\u2014"}
      </TableCell>
      <TableCell>
        <TaskAssigneeCell assigneeIds={task.assigneeIds} />
      </TableCell>
    </TableRow>
  );
}
