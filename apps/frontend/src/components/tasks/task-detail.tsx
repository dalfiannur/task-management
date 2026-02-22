import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTask, useDeleteTask, useUpdateTask } from "@/hooks/use-tasks";
import { useUsers } from "@/hooks/use-users";
import { useModules } from "@/hooks/use-modules";
import {
  Trash2,
  Tag,
  Layers,
  Paperclip,
  CircleDot,
  Signal,
  User as UserIcon,
  CalendarDays,
  CalendarClock,
} from "lucide-react";
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
import { TaskAttachments } from "./task-attachments";
import { TaskActivityTimeline } from "./task-activity-timeline";
import {
  EditableTitle,
  EditableDescription,
  StatusSelect,
  PrioritySelect,
  AssigneeSelect,
  LabelSelect,
  StartDatePicker,
  DueDatePicker,
} from "./task-detail-fields";

interface TaskDetailProps {
  taskId: string;
  projectId: string;
  moduleId: string;
  onClose?: () => void;
}

export function TaskDetail({
  taskId,
  projectId,
  moduleId,
  onClose,
}: TaskDetailProps) {
  const navigate = useNavigate();
  const { data: task, isLoading } = useTask(taskId);
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const { data: users = [] } = useUsers();
  const { data: modules } = useModules(projectId);

  const moduleName =
    modules?.find((m) => m.id === moduleId)?.name ?? moduleId;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate({
        to: "/projects/$projectId",
        params: { projectId },
      });
    }
  };

  const handleDelete = () => {
    deleteTask.mutate(taskId, {
      onSuccess: handleClose,
    });
  };

  const parsedStartDate = task?.startDate
    ? new Date(task.startDate)
    : undefined;
  const parsedDueDate = task?.dueDate ? new Date(task.dueDate) : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto p-0">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !task ? (
          <div className="p-6 text-center text-muted-foreground">
            Task not found
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row">
            {/* Left panel — main content */}
            <div className="flex-1 p-6 sm:border-r min-w-0">
              <DialogHeader className="mb-5">
                <DialogTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Task Details
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Task details for {task.title}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <EditableTitle
                  taskId={taskId}
                  value={task.title}
                  status={task.status}
                  updateTask={updateTask}
                />

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                    Description
                  </p>
                  <EditableDescription
                    taskId={taskId}
                    value={task.description}
                    updateTask={updateTask}
                  />
                </div>

                <TaskActivityTimeline taskId={taskId} projectId={projectId} />
              </div>
            </div>

            {/* Right panel — property panel */}
            <div className="w-full sm:w-[280px] shrink-0 bg-muted/20">
              <div className="px-5 py-4 border-b">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Properties
                </p>
              </div>

              <div className="p-4 space-y-1">
                {/* Status */}
                <PropertyRow icon={CircleDot} label="Status">
                  <StatusSelect
                    taskId={taskId}
                    value={task.status}
                    startDate={task.startDate}
                    updateTask={updateTask}
                  />
                </PropertyRow>

                {/* Priority */}
                <PropertyRow icon={Signal} label="Priority">
                  <PrioritySelect
                    taskId={taskId}
                    value={task.priority}
                    updateTask={updateTask}
                  />
                </PropertyRow>

                {/* Assignee */}
                <PropertyRow icon={UserIcon} label="Assignee">
                  <AssigneeSelect
                    taskId={taskId}
                    value={task.assigneeIds}
                    users={users}
                    updateTask={updateTask}
                  />
                </PropertyRow>

                <div className="h-px bg-border/60 my-2 !mt-3 !mb-3" />

                {/* Start Date */}
                <PropertyRow icon={CalendarDays} label="Start">
                  <StartDatePicker
                    taskId={taskId}
                    value={task.startDate}
                    updateTask={updateTask}
                  />
                </PropertyRow>

                {/* Due Date */}
                <PropertyRow icon={CalendarClock} label="Due">
                  <DueDatePicker
                    taskId={taskId}
                    value={task.dueDate}
                    updateTask={updateTask}
                  />
                </PropertyRow>

                {/* Date range indicator */}
                {parsedStartDate && parsedDueDate && (
                  <div className="pl-7 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                      <div className="h-px flex-1 bg-border/60" />
                      <span className="tabular-nums">
                        {Math.ceil(
                          (parsedDueDate.getTime() -
                            parsedStartDate.getTime()) /
                            (1000 * 60 * 60 * 24),
                        )}{" "}
                        days
                      </span>
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                  </div>
                )}

                <div className="h-px bg-border/60 my-2 !mt-3 !mb-3" />

                {/* Labels */}
                <PropertyRow icon={Tag} label="Labels">
                  <LabelSelect
                    taskId={taskId}
                    projectId={projectId}
                    value={task.labelIds}
                    updateTask={updateTask}
                  />
                </PropertyRow>

                {/* Module */}
                <PropertyRow icon={Layers} label="Module">
                  <span className="text-xs px-2">{moduleName}</span>
                </PropertyRow>

                {/* Attachments */}
                <PropertyRow icon={Paperclip} label="Files">
                  <TaskAttachments
                    projectId={projectId}
                    taskId={taskId}
                  />
                </PropertyRow>
              </div>

              {/* Timestamps + Delete */}
              <div className="px-5 pb-5 space-y-3">
                <div className="h-px bg-border/60" />

                <div className="space-y-0.5 pt-1">
                  <p className="text-[11px] text-muted-foreground/60">
                    Created{" "}
                    {new Date(task.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60">
                    Updated{" "}
                    {new Date(task.updatedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8"
                    >
                      <Trash2 className="size-3.5 mr-1.5" />
                      Delete Task
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete task?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently
                        delete the task &quot;{task.title}&quot;.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PropertyRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-h-[32px]">
      <div className="flex items-center gap-1.5 w-[72px] shrink-0">
        <Icon className="size-3.5 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
