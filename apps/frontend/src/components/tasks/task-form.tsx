import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Calendar as CalendarIcon,
  X,
  CircleDot,
  Signal,
  User as UserIcon,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useCreateTask, useUpdateTask } from "@/hooks/use-tasks";
import { useUsers } from "@/hooks/use-users";
import { useLabels } from "@/hooks/use-labels";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import { Tag } from "lucide-react";

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
  moduleId?: string;
  projectId?: string;
}

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  backlog: "bg-gray-400",
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
  in_review: "bg-violet-400",
  done: "bg-emerald-400",
  cancelled: "bg-red-400",
};

const PRIORITY_DOT_COLORS: Record<TaskPriority, string> = {
  none: "bg-gray-300",
  low: "bg-blue-400",
  medium: "bg-amber-400",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

export function TaskForm({ open, onOpenChange, task, moduleId, projectId }: TaskFormProps) {
  const isEditing = !!task;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: users = [] } = useUsers();
  const { data: labels = [] } = useLabels(projectId);

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? "none",
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assigneeIds ?? [],
  );
  const [startDate, setStartDate] = useState<string | undefined>(
    task?.startDate,
  );
  const [dueDate, setDueDate] = useState<string | undefined>(task?.dueDate);
  const [labelIds, setLabelIds] = useState<string[]>(task?.labelIds ?? []);

  const [startDateOpen, setStartDateOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);

  const parsedStartDate = startDate ? new Date(startDate) : undefined;
  const parsedDueDate = dueDate ? new Date(dueDate) : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (isEditing) {
      updateTask.mutate(
        {
          id: task.id,
          input: {
            title,
            description,
            status,
            priority,
            assigneeIds: assigneeIds.length > 0 ? assigneeIds : null,
            startDate: startDate ?? null,
            dueDate: dueDate ?? null,
            labelIds,
          },
        },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
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
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter to submit
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && title.trim()) {
        e.preventDefault();
        const form = document.querySelector<HTMLFormElement>(
          "[data-task-form]",
        );
        form?.requestSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, title]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto p-0">
        <form onSubmit={handleSubmit} data-task-form>
          <div className="flex flex-col sm:flex-row">
            {/* Left panel — main content */}
            <div className="flex-1 p-6 sm:border-r min-w-0">
              <DialogHeader className="mb-5">
                <DialogTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {isEditing ? "Edit Task" : "New Task"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {isEditing
                    ? "Edit task details"
                    : "Fill in the details to create a new task"}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                {/* Title input with accent bar */}
                <div className="flex gap-3">
                  <div
                    className={cn(
                      "w-1 shrink-0 rounded-full self-stretch transition-colors",
                      STATUS_DOT_COLORS[status],
                    )}
                  />
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Task title..."
                    className="flex-1 text-xl font-bold font-display tracking-tight bg-transparent border-0 outline-none placeholder:font-normal placeholder:text-base placeholder:text-muted-foreground/40"
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                    Description
                  </p>
                  <RichTextEditor
                    content={description}
                    onChange={setDescription}
                    placeholder="Add a description..."
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <span className="text-[11px] text-muted-foreground/50">
                  <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                    ⌘
                  </kbd>{" "}
                  <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                    ↵
                  </kbd>{" "}
                  to submit
                </span>
                <div className="flex items-center gap-2">
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
                    disabled={!title.trim()}
                  >
                    {isEditing ? "Save Changes" : "Create Task"}
                  </Button>
                </div>
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
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as TaskStatus)}
                  >
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent hover:bg-muted/50 transition-colors px-2 w-auto gap-1.5 [&>svg:last-child]:size-3">
                      <span
                        className={cn(
                          "size-2 rounded-full shrink-0",
                          STATUS_DOT_COLORS[status],
                        )}
                      />
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
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                STATUS_DOT_COLORS[key],
                              )}
                            />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PropertyRow>

                {/* Priority */}
                <PropertyRow icon={Signal} label="Priority">
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as TaskPriority)}
                  >
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent hover:bg-muted/50 transition-colors px-2 w-auto gap-1.5 [&>svg:last-child]:size-3">
                      <span
                        className={cn(
                          "size-2 rounded-full shrink-0",
                          PRIORITY_DOT_COLORS[priority],
                        )}
                      />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(TASK_PRIORITY_CONFIG) as [
                          TaskPriority,
                          { label: string; color: string; icon: string },
                        ][]
                      ).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                PRIORITY_DOT_COLORS[key],
                              )}
                            />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PropertyRow>

                {/* Assignee */}
                <PropertyRow icon={UserIcon} label="Assignee">
                  <AssigneeCombobox
                    value={assigneeIds}
                    users={users}
                    onChange={setAssigneeIds}
                  />
                </PropertyRow>

                {/* Labels */}
                <PropertyRow icon={Tag} label="Labels">
                  <LabelCombobox
                    value={labelIds}
                    labels={labels}
                    onChange={setLabelIds}
                  />
                </PropertyRow>

                <div className="h-px bg-border/60 my-2 !mt-3 !mb-3" />

                {/* Start Date */}
                <PropertyRow icon={CalendarDays} label="Start">
                  <Popover
                    open={startDateOpen}
                    onOpenChange={setStartDateOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors",
                          !parsedStartDate && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="size-3" />
                        {parsedStartDate
                          ? format(parsedStartDate, "MMM d, yyyy")
                          : "Set date"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={parsedStartDate}
                        onSelect={(d) => {
                          setStartDate(d ? d.toISOString() : undefined);
                          setStartDateOpen(false);
                        }}
                        initialFocus
                      />
                      {parsedStartDate && (
                        <div className="p-2 border-t">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full text-muted-foreground text-xs h-7"
                            onClick={() => {
                              setStartDate(undefined);
                              setStartDateOpen(false);
                            }}
                          >
                            <X className="mr-1 size-3" />
                            Clear
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </PropertyRow>

                {/* Due Date */}
                <PropertyRow icon={CalendarClock} label="Due">
                  <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors",
                          !parsedDueDate && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="size-3" />
                        {parsedDueDate
                          ? format(parsedDueDate, "MMM d, yyyy")
                          : "Set date"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={parsedDueDate}
                        onSelect={(d) => {
                          setDueDate(d ? d.toISOString() : undefined);
                          setDueDateOpen(false);
                        }}
                        initialFocus
                      />
                      {parsedDueDate && (
                        <div className="p-2 border-t">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full text-muted-foreground text-xs h-7"
                            onClick={() => {
                              setDueDate(undefined);
                              setDueDateOpen(false);
                            }}
                          >
                            <X className="mr-1 size-3" />
                            Clear
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
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
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssigneeCombobox({
  value,
  users,
  onChange,
}: {
  value: string[];
  users: { id: string; name: string; avatarUrl?: string }[];
  onChange: (userIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedUsers = users.filter((u) => value.includes(u.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors w-full"
        >
          {selectedUsers.length > 0 ? (
            <>
              <div className="flex items-center -space-x-1.5">
                {selectedUsers.slice(0, 3).map((user) => (
                  <Avatar key={user.id} className="size-4 ring-1 ring-background">
                    <AvatarImage src={user.avatarUrl} />
                    <AvatarFallback className="text-[8px]">
                      {user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <span className="truncate">
                {selectedUsers.length === 1
                  ? selectedUsers[0].name
                  : `${selectedUsers.length} assignees`}
              </span>
              <X
                className="size-3 ml-auto text-muted-foreground/50 hover:text-foreground shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Unassigned</span>
              <ChevronsUpDown className="size-3 ml-auto text-muted-foreground/40 shrink-0" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search users..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center">
              No user found.
            </CommandEmpty>
            <CommandGroup>
              {users.map((user) => {
                const initials = user.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);
                const isSelected = value.includes(user.id);
                return (
                  <CommandItem
                    key={user.id}
                    value={user.name}
                    onSelect={() => {
                      onChange(
                        isSelected
                          ? value.filter((id) => id !== user.id)
                          : [...value, user.id],
                      );
                    }}
                    className="text-xs"
                  >
                    <Avatar className="size-5 mr-1.5">
                      <AvatarImage src={user.avatarUrl} />
                      <AvatarFallback className="text-[9px]">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    {user.name}
                    <Check
                      className={cn(
                        "ml-auto size-3.5",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LabelCombobox({
  value,
  labels,
  onChange,
}: {
  value: string[];
  labels: { id: string; name: string; color: string }[];
  onChange: (labelIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = labels.filter((l) => value.includes(l.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors w-full"
        >
          {selectedLabels.length > 0 ? (
            <>
              <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                {selectedLabels.slice(0, 3).map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted"
                  >
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="truncate max-w-[60px]">{label.name}</span>
                  </span>
                ))}
                {selectedLabels.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{selectedLabels.length - 3}
                  </span>
                )}
              </div>
              <X
                className="size-3 ml-auto text-muted-foreground/50 hover:text-foreground shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            </>
          ) : (
            <>
              <span className="text-muted-foreground">None</span>
              <ChevronsUpDown className="size-3 ml-auto text-muted-foreground/40 shrink-0" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search labels..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center">
              No labels found.
            </CommandEmpty>
            <CommandGroup>
              {labels.map((label) => {
                const isSelected = value.includes(label.id);
                return (
                  <CommandItem
                    key={label.id}
                    value={label.name}
                    onSelect={() => {
                      onChange(
                        isSelected
                          ? value.filter((id) => id !== label.id)
                          : [...value, label.id],
                      );
                    }}
                    className="text-xs"
                  >
                    <span
                      className="size-2.5 rounded-full shrink-0 mr-1.5"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    <Check
                      className={cn(
                        "ml-auto size-3.5",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
