import { useNavigate } from "react-router";
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
import { useState } from "react";
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
  MessageSquare,
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
import { CommentsDialog } from "./comments-dialog";
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
import { PropertyRow } from "@/components/shared/property-row";
import styles from "./task-detail.module.css";

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
  const [commentsOpen, setCommentsOpen] = useState(false);

  const moduleName =
    modules?.find((m) => m.id === moduleId)?.name ?? moduleId;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate(`/projects/${projectId}`);
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
      <DialogContent className={styles.dialogContent}>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !task ? (
          <div className={styles.notFound}>
            Task not found
          </div>
        ) : (
          <div className={styles.layout}>
            {/* Left panel -- main content */}
            <div className={styles.leftPanel}>
              <DialogHeader className={styles.headerMargin}>
                <DialogTitle className={styles.headerTitle}>
                  Task Details
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Task details for {task.title}
                </DialogDescription>
              </DialogHeader>

              <div className={styles.leftContent}>
                <EditableTitle
                  taskId={taskId}
                  value={task.title}
                  status={task.status}
                  updateTask={updateTask}
                />

                <div className={styles.descriptionSection}>
                  <p className={styles.sectionLabel}>
                    Description
                  </p>
                  <EditableDescription
                    taskId={taskId}
                    value={task.description}
                    updateTask={updateTask}
                  />
                </div>

                <Button
                  variant="ghost"
                  className={styles.commentsButton}
                  onClick={() => setCommentsOpen(true)}
                >
                  <MessageSquare className={styles.commentsButtonIcon} />
                  Comments
                </Button>
              </div>
            </div>

            {/* Right panel -- property panel */}
            <div className={styles.rightPanel}>
              <div className={styles.propertiesHeader}>
                <p className={styles.propertiesLabel}>
                  Properties
                </p>
              </div>

              <div className={styles.propertiesBody}>
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

                <div className={styles.divider} />

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
                  <div className={styles.dateRange}>
                    <div className={styles.dateRangeInner}>
                      <div className={styles.dateRangeLine} />
                      <span className={styles.dateRangeDays}>
                        {Math.ceil(
                          (parsedDueDate.getTime() -
                            parsedStartDate.getTime()) /
                          (1000 * 60 * 60 * 24),
                        )}{" "}
                        days
                      </span>
                      <div className={styles.dateRangeLine} />
                    </div>
                  </div>
                )}

                <div className={styles.divider} />

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
                  <span className={styles.moduleName}>{moduleName}</span>
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
              <div className={styles.timestampsSection}>
                <div className={styles.timestampsDivider} />

                <div className={styles.timestamps}>
                  <p className={styles.timestampText}>
                    Created{" "}
                    {new Date(task.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className={styles.timestampText}>
                    Updated{" "}
                    {new Date(task.updatedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  {task.completedAt && (
                    <p className={styles.timestampText}>
                      Completed{" "}
                      {new Date(task.completedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                      {task.dueDate && (
                        <span
                          className={
                            new Date(task.completedAt) <=
                            new Date(task.dueDate)
                              ? styles.onTimeLabel
                              : styles.lateLabel
                          }
                        >
                          {new Date(task.completedAt) <=
                          new Date(task.dueDate)
                            ? " · on time"
                            : " · late"}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.deleteButton}
                    >
                      <Trash2 className={styles.deleteIcon} />
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

      <CommentsDialog
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        taskId={taskId}
        projectId={projectId}
        taskTitle={task?.title}
      />
    </Dialog>
  );
}

