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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTask, useDeleteTask, useUpdateTask, useCreateTask } from "@/hooks/use-tasks";
import { useUser } from "@/hooks/use-users";
import { useModules } from "@/hooks/use-modules";
import { useLabels } from "@/hooks/use-labels";
import { usePagesByTask, usePages, useUpdatePage } from "@/hooks/use-pages";
import { useState } from "react";
import { useFormShortcut } from "@/hooks/use-form-shortcut";
import {
  Trash2,
  Tag,
  Layers,
  CircleDot,
  Signal,
  User as UserIcon,
  MessageSquare,
  FileText,
  Plus,
  X,
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type Task,
  type UpdateTaskInput,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import { startOfDay } from "date-fns";
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
import { DatePickerField } from "@/components/shared/date-picker-field";
import { AssigneeCombobox } from "@/components/shared/assignee-combobox";
import { LabelCombobox } from "@/components/shared/label-combobox";
import { DateProgress } from "@/components/shared/date-progress";

// --- Pill classes for create mode selects ---

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
  done: "bg-emerald-400",
  cancelled: "bg-red-400",
};

const STATUS_PILL_CLASSES: Record<TaskStatus, string> = {
  todo: "bg-blue-900/40 text-blue-300",
  in_progress: "bg-amber-900/40 text-amber-300",
  done: "bg-emerald-900/40 text-emerald-300",
  cancelled: "bg-red-900/40 text-red-300",
};

const PRIORITY_DOT_COLORS: Record<TaskPriority, string> = {
  none: "bg-gray-300",
  low: "bg-blue-400",
  medium: "bg-amber-400",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

const PRIORITY_PILL_CLASSES: Record<TaskPriority, string> = {
  none: "bg-gray-800/40 text-gray-400",
  low: "bg-blue-900/40 text-blue-300",
  medium: "bg-amber-900/40 text-amber-300",
  high: "bg-orange-900/40 text-orange-300",
  urgent: "bg-red-900/40 text-red-300",
};

// --- Edit mode (existing task) ---

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
  const { data: modules } = useModules(projectId);
  const { data: linkedPages = [] } = usePagesByTask(taskId);
  const { data: allPages = [] } = usePages(projectId);
  const updatePage = useUpdatePage();
  const { data: creator } = useUser(task?.createdBy);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [linkPageOpen, setLinkPageOpen] = useState(false);

  const availablePages = allPages.filter(
    (p) => !p.pageInfo.linkedTaskId && !p.pageInfo.linkedModuleId,
  );

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
      <DialogContent className="max-w-[1124px] sm:max-w-[1124px] max-h-[85vh] overflow-y-auto p-0">
        {isLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !task ? (
          <div className="p-5 text-center text-muted-foreground">
            Task not found
          </div>
        ) : (
          <div className="flex flex-col overflow-x-clip sm:flex-row">
            {/* Left panel */}
            <div className="flex-1 flex flex-col min-w-0 sm:border-r sm:border-border">
              <div className="p-5">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-sm leading-4 font-semibold font-mono uppercase tracking-widest text-muted-foreground/60">
                    Task Details
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    Task details for {task.title}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <EditableTitle
                    taskId={taskId}
                    value={task.title}
                    status={task.status}
                    updateTask={updateTask}
                  />
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground/50">
                      Description
                    </p>
                    <EditableDescription
                      taskId={taskId}
                      value={task.description}
                      updateTask={updateTask}
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-auto p-4 bg-slate-900/50 border-t border-border">
                <Button
                  variant="ghost"
                  className="text-muted-foreground text-sm gap-1.5 hover:text-foreground"
                  onClick={() => setCommentsOpen(true)}
                >
                  <MessageSquare className="size-3.5" />
                  Comments
                </Button>
              </div>
            </div>

            {/* Right panel */}
            <RightPanel
              mode="edit"
              taskId={taskId}
              projectId={projectId}
              moduleId={moduleId}
              task={{
                status: task.status,
                priority: task.priority,
                assigneeIds: task.assigneeIds,
                labelIds: task.labelIds,
                startDate: task.startDate,
                dueDate: task.dueDate,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                completedAt: task.completedAt,
                createdBy: task.createdBy,
              }}
              updateTask={updateTask}
              moduleName={moduleName}
              parsedStartDate={parsedStartDate}
              parsedDueDate={parsedDueDate}
              creator={creator}
              deleteButton={
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full h-10 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all text-sm font-medium"
                    >
                      <Trash2 className="size-4 mr-2" />
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
                      <AlertDialogAction
                        disabled={deleteTask.isLoading}
                        onClick={handleDelete}
                      >
                        {deleteTask.isLoading ? "Deleting..." : "Delete"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              }
              linkedPages={linkedPages}
              availablePages={availablePages}
              linkPageOpen={linkPageOpen}
              setLinkPageOpen={setLinkPageOpen}
              onLinkPage={(pageId) => {
                updatePage.mutate({ id: pageId, projectId, linkedTaskId: taskId });
              }}
              onUnlinkPage={(pageId) => {
                updatePage.mutate({ id: pageId, projectId, linkedTaskId: "" });
              }}
              navigate={navigate}
            />
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

// --- Create mode (new task) ---

interface TaskCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleId?: string;
  projectId?: string;
}

export function TaskCreate({
  open,
  onOpenChange,
  moduleId,
  projectId,
}: TaskCreateProps) {
  const createTask = useCreateTask();
  const { data: modules } = useModules(projectId);
  const { data: labels = [] } = useLabels(projectId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string | undefined>();
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [labelIds, setLabelIds] = useState<string[]>([]);

  const today = startOfDay(new Date());
  const parsedStartDate = startDate ? new Date(startDate) : undefined;
  const parsedDueDate = dueDate ? new Date(dueDate) : undefined;

  const moduleName = moduleId
    ? (modules?.find((m) => m.id === moduleId)?.name ?? moduleId)
    : undefined;

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("none");
    setAssigneeIds([]);
    setStartDate(undefined);
    setDueDate(undefined);
    setLabelIds([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createTask.mutate(
      {
        title,
        description,
        status,
        priority,
        assigneeIds,
        startDate,
        dueDate,
        moduleId: moduleId ?? "",
        labelIds,
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      },
    );
  };

  useFormShortcut(open, "[data-task-form]", !!title.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1124px] sm:max-w-[1124px] max-h-[85vh] overflow-y-auto p-0">
        <form onSubmit={handleSubmit} data-task-form>
          <div className="flex flex-col overflow-x-clip sm:flex-row">
            {/* Left panel */}
            <div className="flex-1 flex flex-col min-w-0 sm:border-r sm:border-border">
              <div className="p-5">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-sm leading-4 font-semibold font-mono uppercase tracking-widest text-muted-foreground/60">
                    New Task
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    Fill in the details to create a new task
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Title */}
                  <div className="flex gap-2.5">
                    <div
                      className={cn(
                        "w-1 shrink-0 rounded-full self-stretch transition-all duration-300",
                        STATUS_DOT_COLORS[status],
                      )}
                    />
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Task title..."
                      className="flex-1 text-2xl font-bold tracking-tight bg-transparent border-0 outline-none text-foreground placeholder:font-normal placeholder:text-base placeholder:text-muted-foreground"
                      autoFocus
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground/50">
                      Description
                    </p>
                    <RichTextEditor
                      content={description}
                      onChange={setDescription}
                      placeholder="Describe what needs to be done, acceptance criteria, and any relevant context..."
                      minHeight="500px"
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-auto p-4 bg-slate-900/50 border-t border-border flex items-center justify-between">
                <span className="text-sm font-mono text-muted-foreground">
                  <kbd className="px-1.5 py-0.5 rounded-xl bg-accent text-sm font-mono">
                    &#8984;
                  </kbd>{" "}
                  <kbd className="px-1.5 py-0.5 rounded-xl bg-accent text-sm font-mono">
                    &#8629;
                  </kbd>{" "}
                  to submit
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!title.trim() || createTask.isLoading}
                  >
                    {createTask.isLoading ? "Creating..." : "Create Task"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Right panel */}
            <div className="w-full shrink-0 sm:w-[360px] bg-muted/10 overflow-y-auto">
              <div className="p-5 space-y-6">
                <p className="text-xs font-bold text-primary uppercase tracking-widest">
                  Properties
                </p>

                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-4">
                  {/* Status */}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CircleDot className="size-4" />
                    <span className="text-sm">Status</span>
                  </div>
                  <div className="flex justify-end">
                    <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                      <SelectTrigger
                        className={cn(
                          "h-7 text-xs leading-4 font-bold border-0 shadow-none px-3 w-auto gap-1 rounded-full transition-colors [&_svg:last-child]:size-3",
                          STATUS_PILL_CLASSES[status],
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]).map(
                          ([key, config]) => (
                            <SelectItem key={key} value={key}>
                              <div className="flex items-center gap-2">
                                <span className={cn("size-2 rounded-full shrink-0", STATUS_DOT_COLORS[key])} />
                                {config.label}
                              </div>
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority */}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Signal className="size-4" />
                    <span className="text-sm">Priority</span>
                  </div>
                  <div className="flex justify-end">
                    <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                      <SelectTrigger
                        className={cn(
                          "h-7 text-xs leading-4 font-bold border-0 shadow-none px-3 w-auto gap-1 rounded-full transition-colors [&_svg:last-child]:size-3",
                          PRIORITY_PILL_CLASSES[priority],
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(TASK_PRIORITY_CONFIG) as [TaskPriority, { label: string; color: string; icon: string }][]).map(
                          ([key, config]) => (
                            <SelectItem key={key} value={key}>
                              <div className="flex items-center gap-2">
                                <span className={cn("size-2 rounded-full shrink-0", PRIORITY_DOT_COLORS[key])} />
                                {config.label}
                              </div>
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Assignee */}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <UserIcon className="size-4" />
                    <span className="text-sm">Assignee</span>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[200px]">
                      <AssigneeCombobox value={assigneeIds} onChange={setAssigneeIds} />
                    </div>
                  </div>

                  {/* Labels */}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Tag className="size-4" />
                    <span className="text-sm">Labels</span>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[200px]">
                      <LabelCombobox
                        value={labelIds}
                        labels={labels}
                        onChange={setLabelIds}
                        projectId={projectId}
                      />
                    </div>
                  </div>

                  {/* Module */}
                  {moduleName && (
                    <>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Layers className="size-4" />
                        <span className="text-sm">Module</span>
                      </div>
                      <div className="flex justify-end">
                        <span className="text-sm font-medium">{moduleName}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="h-px bg-border" />

                {/* Dates */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest mb-1">Start Date</p>
                      <DatePickerField
                        value={parsedStartDate}
                        onChange={(d) => setStartDate(d ? d.toISOString() : undefined)}
                        minDate={today}
                      />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest mb-1">Due Date</p>
                      <DatePickerField
                        value={parsedDueDate}
                        onChange={(d) => setDueDate(d ? d.toISOString() : undefined)}
                        minDate={today}
                      />
                    </div>
                  </div>

                  {parsedStartDate && parsedDueDate && (
                    <DateProgress startDate={parsedStartDate} dueDate={parsedDueDate} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Shared right panel for edit mode ---

interface RightPanelProps {
  mode: "edit";
  taskId: string;
  projectId: string;
  moduleId: string;
  task: {
    status: TaskStatus;
    priority: TaskPriority;
    assigneeIds: string[];
    labelIds: string[];
    startDate?: string;
    dueDate?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    createdBy?: string;
  };
  updateTask: {
    mutate: (vars: { id: string; input: UpdateTaskInput }, opts?: { onSuccess?: (data: Task) => void }) => void;
    isLoading: boolean;
  };
  moduleName: string;
  parsedStartDate?: Date;
  parsedDueDate?: Date;
  creator?: { name: string } | null;
  deleteButton: React.ReactNode;
  linkedPages: { id: string; pageInfo: { title: string; icon?: string; linkedTaskId?: string; linkedModuleId?: string } }[];
  availablePages: { id: string; pageInfo: { title: string; icon?: string; linkedTaskId?: string; linkedModuleId?: string } }[];
  linkPageOpen: boolean;
  setLinkPageOpen: (open: boolean) => void;
  onLinkPage: (pageId: string) => void;
  onUnlinkPage: (pageId: string) => void;
  navigate: (path: string) => void;
}

function RightPanel({
  taskId,
  projectId,
  task,
  updateTask,
  moduleName,
  parsedStartDate,
  parsedDueDate,
  creator,
  deleteButton,
  linkedPages,
  availablePages,
  linkPageOpen,
  setLinkPageOpen,
  onLinkPage,
  onUnlinkPage,
  navigate,
}: RightPanelProps) {
  return (
    <div className="w-full shrink-0 sm:w-[360px] bg-muted/10 overflow-y-auto">
      <div className="p-5 space-y-6">
        <p className="text-xs font-bold text-primary uppercase tracking-widest">
          Properties
        </p>

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-4">
          {/* Status */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <CircleDot className="size-4" />
            <span className="text-sm">Status</span>
          </div>
          <div className="flex justify-end">
            <StatusSelect
              taskId={taskId}
              value={task.status}
              startDate={task.startDate}
              updateTask={updateTask}
            />
          </div>

          {/* Priority */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Signal className="size-4" />
            <span className="text-sm">Priority</span>
          </div>
          <div className="flex justify-end">
            <PrioritySelect
              taskId={taskId}
              value={task.priority}
              updateTask={updateTask}
            />
          </div>

          {/* Assignee */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <UserIcon className="size-4" />
            <span className="text-sm">Assignee</span>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[200px]">
              <AssigneeSelect
                taskId={taskId}
                value={task.assigneeIds}
                updateTask={updateTask}
              />
            </div>
          </div>

          {/* Labels */}
          {task.labelIds.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Tag className="size-4" />
                <span className="text-sm">Labels</span>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[200px]">
                  <LabelSelect
                    taskId={taskId}
                    projectId={projectId}
                    value={task.labelIds}
                    updateTask={updateTask}
                  />
                </div>
              </div>
            </>
          )}

          {/* Module */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="size-4" />
            <span className="text-sm">Module</span>
          </div>
          <div className="flex justify-end">
            <span className="text-sm font-medium">{moduleName}</span>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Dates */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest mb-1">Start Date</p>
              <StartDatePicker taskId={taskId} value={task.startDate} updateTask={updateTask} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest mb-1">Due Date</p>
              <DueDatePicker taskId={taskId} value={task.dueDate} updateTask={updateTask} />
            </div>
          </div>

          {parsedStartDate && parsedDueDate && (
            <DateProgress startDate={parsedStartDate} dueDate={parsedDueDate} />
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Files */}
        <TaskAttachments projectId={projectId} taskId={taskId} />

        {/* Pages */}
        <>
          <div className="h-px bg-border" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="size-4" />
                <span className="text-sm font-medium">Pages</span>
              </div>
              <Popover open={linkPageOpen} onOpenChange={setLinkPageOpen}>
                <PopoverTrigger asChild>
                  <button className="inline-flex items-center gap-1 text-xs font-medium text-primary cursor-pointer hover:text-primary/80 transition-colors">
                    <Plus className="size-3" />
                    Link
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-1.5" align="end">
                  {availablePages.length === 0 ? (
                    <p className="text-[0.8125rem] text-muted-foreground text-center py-3">
                      No available pages
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto">
                      {availablePages.map((page) => (
                        <Button
                          key={page.id}
                          variant="ghost"
                          className="flex items-center gap-1.5 w-full py-1.5 px-2 text-[0.8125rem] rounded-md text-left h-auto justify-start"
                          onClick={() => {
                            onLinkPage(page.id);
                            setLinkPageOpen(false);
                          }}
                        >
                          <span className="text-xs shrink-0">
                            {page.pageInfo.icon || <FileText className="size-3 text-muted-foreground" />}
                          </span>
                          <span className="truncate">
                            {page.pageInfo.title || "Untitled"}
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            {linkedPages.length > 0 && (
              <div className="space-y-1.5">
                {linkedPages.map((page) => (
                  <a
                    key={page.id}
                    href={`/projects/${projectId}/pages/${page.id}`}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-sm text-foreground no-underline hover:bg-muted/50 transition-colors group"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/projects/${projectId}/pages/${page.id}`);
                    }}
                  >
                    {page.pageInfo.icon || <FileText className="size-3.5 text-muted-foreground shrink-0" />}
                    <span className="truncate flex-1">
                      {page.pageInfo.title || "Untitled"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 rounded-md opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onUnlinkPage(page.id);
                      }}
                    >
                      <X className="size-3" />
                    </Button>
                  </a>
                ))}
              </div>
            )}
          </div>
        </>

        <div className="h-px bg-border" />

        {/* Footer — Created by + timestamps */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Created By</p>
            <span className="text-xs font-semibold uppercase tracking-wide">{creator?.name ?? "Unknown"}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <p className="text-[10px] text-muted-foreground/50">Created Date</p>
            <span className="text-[10px] text-muted-foreground/50">
              {new Date(task.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          {task.updatedAt !== task.createdAt && (
            <div className="flex justify-between items-baseline">
              <p className="text-[10px] text-muted-foreground/50">Updated</p>
              <span className="text-[10px] text-muted-foreground/50">
                {new Date(task.updatedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          )}
          {task.completedAt && (
            <div className="flex justify-between items-baseline">
              <p className="text-[10px] text-muted-foreground/50">Completed</p>
              <span className="text-[10px] text-muted-foreground/50">
                {new Date(task.completedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                {task.dueDate && (
                  <span
                    className={
                      new Date(task.completedAt) <= new Date(task.dueDate)
                        ? " text-green-400"
                        : " text-destructive"
                    }
                  >
                    {new Date(task.completedAt) <= new Date(task.dueDate)
                      ? " · on time"
                      : " · late"}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Delete */}
        {deleteButton}
      </div>
    </div>
  );
}
