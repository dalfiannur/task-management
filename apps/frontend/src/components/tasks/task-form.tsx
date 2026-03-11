import { useState } from "react";
import { useFormShortcut } from "@/hooks/use-form-shortcut";
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
  X,
  CircleDot,
  Signal,
  User as UserIcon,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useCreateTask, useUpdateTask } from "@/hooks/use-tasks";
import { useSearchUsers, useUser } from "@/hooks/use-users";
import { useLabels } from "@/hooks/use-labels";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import { Tag } from "lucide-react";
import { LabelCombobox } from "@/components/shared/label-combobox";
import { PropertyRow } from "@/components/shared/property-row";
import { DatePickerField } from "@/components/shared/date-picker-field";

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
  moduleId?: string;
  projectId?: string;
}

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
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

  const today = startOfDay(new Date());
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
        {
          onSuccess: () => {
            resetForm();
            onOpenChange(false);
          },
        },
      );
    }
  };

  const resetForm = () => {
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setStatus(task?.status ?? "todo");
    setPriority(task?.priority ?? "none");
    setAssigneeIds(task?.assigneeIds ?? []);
    setStartDate(task?.startDate);
    setDueDate(task?.dueDate);
    setLabelIds(task?.labelIds ?? []);
  };

  useFormShortcut(open, "[data-task-form]", !!title.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[72rem] sm:max-w-[72rem] max-h-[85vh] overflow-y-auto p-0">
        <form onSubmit={handleSubmit} data-task-form>
          <div className="flex flex-col sm:flex-row">
            {/* Left panel -- main content */}
            <div className="flex-1 p-5 min-w-0 sm:border-r sm:border-border">
              <DialogHeader className="mb-4">
                <DialogTitle className="text-sm leading-4 font-semibold font-mono uppercase tracking-widest text-muted-foreground">
                  {isEditing ? "Edit Task" : "New Task"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {isEditing
                    ? "Edit task details"
                    : "Fill in the details to create a new task"}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Title input with accent bar */}
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
                    className="flex-1 text-lg leading-6 font-bold tracking-tight bg-transparent border-0 outline-none text-foreground placeholder:font-normal placeholder:text-[0.9375rem] placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
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

              {/* Footer */}
              <div className="flex items-center justify-between mt-5 pt-3.5 border-t border-border">
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
                    disabled={!title.trim()}
                  >
                    {isEditing ? "Save Changes" : "Create Task"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Right panel -- property panel (Subtle Glass) */}
            <div className="w-full shrink-0 bg-accent sm:w-[300px]">
              <div className="py-3.5 px-4 border-b border-border">
                <p className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
                  Properties
                </p>
              </div>

              <div className="p-3.5 space-y-1">
                {/* Status */}
                <PropertyRow icon={CircleDot} label="Status">
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as TaskStatus)}
                  >
                    <SelectTrigger className="h-7 text-sm leading-4 font-mono border-0 shadow-none bg-transparent px-2 w-auto gap-1.5 transition-all duration-300 hover:bg-accent [&_svg:last-child]:size-3">
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
                                "size-2 rounded-full shrink-0",
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
                    <SelectTrigger className="h-7 text-sm leading-4 font-mono border-0 shadow-none bg-transparent px-2 w-auto gap-1.5 transition-all duration-300 hover:bg-accent [&_svg:last-child]:size-3">
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
                                "size-2 rounded-full shrink-0",
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
                    onChange={setAssigneeIds}
                  />
                </PropertyRow>

                {/* Labels */}
                <PropertyRow icon={Tag} label="Labels">
                  <LabelCombobox
                    value={labelIds}
                    labels={labels}
                    onChange={setLabelIds}
                    projectId={projectId}
                  />
                </PropertyRow>

                <div className="h-px bg-border !mt-2.5 !mb-2.5" />

                {/* Start Date */}
                <PropertyRow icon={CalendarDays} label="Start">
                  <DatePickerField
                    value={parsedStartDate}
                    onChange={(d) => setStartDate(d ? d.toISOString() : undefined)}
                    minDate={today}
                  />
                </PropertyRow>

                {/* Due Date */}
                <PropertyRow icon={CalendarClock} label="Due">
                  <DatePickerField
                    value={parsedDueDate}
                    onChange={(d) => setDueDate(d ? d.toISOString() : undefined)}
                    minDate={today}
                  />
                </PropertyRow>

                {/* Date range indicator */}
                {parsedStartDate && parsedDueDate && (
                  <div className="pl-[1.75rem] pt-1">
                    <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground">
                      <div className="h-px flex-1 bg-border" />
                      <span className="tabular-nums">
                        {Math.ceil(
                          (parsedDueDate.getTime() -
                            parsedStartDate.getTime()) /
                            (1000 * 60 * 60 * 24),
                        )}{" "}
                        days
                      </span>
                      <div className="h-px flex-1 bg-border" />
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

function AssigneeAvatar({ userId }: { userId: string }) {
  const { data: user } = useUser(userId);
  const name = user?.name ?? "...";
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return (
    <Avatar className="size-4 ring-1 ring-background">
      <AvatarImage src={user?.avatarUrl} />
      <AvatarFallback className="text-[8px]">{initials}</AvatarFallback>
    </Avatar>
  );
}

function AssigneeLabel({ userIds }: { userIds: string[] }) {
  const { data: firstUser } = useUser(userIds[0]);
  if (userIds.length === 1) return <span className="truncate">{firstUser?.name ?? "..."}</span>;
  return <span className="truncate">{userIds.length} assignees</span>;
}

function SelectedAssigneeItem({ userId, onDeselect }: { userId: string; onDeselect: () => void }) {
  const { data: user } = useUser(userId);
  const name = user?.name ?? "...";
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return (
    <CommandItem
      value={userId}
      onSelect={onDeselect}
      className="text-xs"
    >
      <Avatar className="size-5 mr-1.5">
        <AvatarImage src={user?.avatarUrl} />
        <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
      </Avatar>
      {name}
      <Check className="ml-auto size-3.5 opacity-100" />
    </CommandItem>
  );
}

function AssigneeCombobox({
  value,
  onChange,
}: {
  value: string[];
  onChange: (userIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: searchResults } = useSearchUsers(search);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          role="combobox"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-2xl px-2 h-7 text-sm leading-4 transition-all duration-300 w-full hover:bg-accent"
        >
          {value.length > 0 ? (
            <>
              <div className="flex items-center [&>*+*]:-ml-1.5">
                {value.slice(0, 3).map((id) => (
                  <AssigneeAvatar key={id} userId={id} />
                ))}
              </div>
              <AssigneeLabel userIds={value} />
              <X
                className="size-3 ml-auto text-muted-foreground shrink-0 hover:text-foreground transition-all duration-300"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Unassigned</span>
              <ChevronsUpDown className="size-3 ml-auto text-muted-foreground shrink-0" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search users..."
            className="h-8 text-xs"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center">
              {search ? "No user found." : "Type to search..."}
            </CommandEmpty>
            <CommandGroup>
              {/* Show selected assignees at top when no search query */}
              {!search && value.map((id) => (
                <SelectedAssigneeItem
                  key={id}
                  userId={id}
                  onDeselect={() => onChange(value.filter((v) => v !== id))}
                />
              ))}
              {searchResults?.filter((u) => !value.includes(u.id)).map((user) => {
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
                    value={user.id}
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
