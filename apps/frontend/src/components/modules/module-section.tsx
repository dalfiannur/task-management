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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useDeleteModule } from "@/hooks/use-modules";
import { useUsers } from "@/hooks/use-users";
import { ChevronRight, Delete, Plus } from "lucide-react";
import { TASK_STATUS_CONFIG, type Module, type Task, type TaskStatus, type UpdateTaskInput } from "@/types/task";
import { type ProjectStatus, } from "@/types/project"
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

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
    return <span className="text-muted-foreground">&mdash;</span>;
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
      <div className="flex items-center gap-2">
        <Avatar className="size-5">
          <AvatarImage src={user.avatarUrl} />
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        <span className="text-sm truncate">{user.name}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center -space-x-1.5">
        {assignedUsers.slice(0, 3).map((user) => {
          const initials = user.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
          return (
            <Avatar key={user.id} className="size-5 ring-1 ring-background">
              <AvatarImage src={user.avatarUrl} />
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            </Avatar>
          );
        })}
      </div>
      {assignedUsers.length > 3 && (
        <span className="text-xs text-muted-foreground">+{assignedUsers.length - 3}</span>
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const color = MODULE_COLORS[colorIndex % MODULE_COLORS.length];

  const taskCount = tasks?.length ?? 0;
  const doneCount = tasks?.filter((t) => t.status === "done").length ?? 0;
  const progressPct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

  return (
    <>
      <Collapsible defaultOpen className="group/module">
        <div
          className="rounded-lg border overflow-hidden border-l-4"
          style={{ borderLeftColor: color }}
        >
          <div className="flex w-full items-center gap-2 px-4 py-3">
            <CollapsibleTrigger className="flex items-center gap-2 flex-1 hover:bg-accent/50 transition-colors rounded -m-1 p-1">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/module:rotate-90" />
              <span className="font-semibold text-sm" style={{ color }}>
                {module.name}
              </span>
              <Badge variant="secondary" className="ml-1 text-xs tabular-nums">
                {isLoading ? "..." : taskCount}
              </Badge>
              {!isLoading && taskCount > 0 && (
                <div className="flex items-center gap-2 ml-auto mr-1">
                  <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progressPct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums w-7 text-right">
                    {progressPct}%
                  </span>
                </div>
              )}
            </CollapsibleTrigger>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                >
                  <Delete className="size-4 mr-2" />
                  Delete Module
                </Button>
              </AlertDialogTrigger>
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
                  <TableHead className="pl-10">Task</TableHead>
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
                        <TableCell className="pl-10">
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
                      className="text-center py-6 text-muted-foreground"
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
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => setTaskFormOpen(true)}
                  >
                    <TableCell colSpan={5} className="pl-10 py-2">
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <Plus className="size-3.5" />
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
      className="cursor-pointer hover:bg-accent/50"
      onClick={onNavigate}
    >
      <TableCell className="pl-10 font-medium">{task.title}</TableCell>
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
              "h-auto rounded-full border-transparent px-2 py-0.5 text-xs font-medium w-fit shadow-none [&>svg]:hidden",
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
      <TableCell className="text-muted-foreground">
        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "\u2014"}
      </TableCell>
      <TableCell>
        <TaskAssigneeCell assigneeIds={task.assigneeIds} />
      </TableCell>
    </TableRow>
  );
}
