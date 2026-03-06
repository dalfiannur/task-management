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
import styles from "./task-form.module.css";

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
  moduleId?: string;
  projectId?: string;
}

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: styles.dotTodo,
  in_progress: styles.dotInProgress,
  done: styles.dotDone,
  cancelled: styles.dotCancelled,
};

const PRIORITY_DOT_COLORS: Record<TaskPriority, string> = {
  none: styles.dotPriorityNone,
  low: styles.dotPriorityLow,
  medium: styles.dotPriorityMedium,
  high: styles.dotPriorityHigh,
  urgent: styles.dotPriorityUrgent,
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
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit} data-task-form>
          <div className={styles.formLayout}>
            {/* Left panel -- main content */}
            <div className={styles.leftPanel}>
              <DialogHeader className={styles.headerMargin}>
                <DialogTitle className={styles.headerTitle}>
                  {isEditing ? "Edit Task" : "New Task"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {isEditing
                    ? "Edit task details"
                    : "Fill in the details to create a new task"}
                </DialogDescription>
              </DialogHeader>

              <div className={styles.leftContent}>
                {/* Title input with accent bar */}
                <div className={styles.titleRow}>
                  <div
                    className={cn(
                      styles.titleAccent,
                      STATUS_DOT_COLORS[status],
                    )}
                  />
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Task title..."
                    className={styles.titleInput}
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div className={styles.descriptionSection}>
                  <p className={styles.sectionLabel}>
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
              <div className={styles.footer}>
                <span className={styles.shortcutHint}>
                  <kbd className={styles.kbd}>
                    &#8984;
                  </kbd>{" "}
                  <kbd className={styles.kbd}>
                    &#8629;
                  </kbd>{" "}
                  to submit
                </span>
                <div className={styles.footerActions}>
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
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as TaskStatus)}
                  >
                    <SelectTrigger className={styles.propertyTrigger}>
                      <span
                        className={cn(
                          styles.dot,
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
                          <div className={styles.selectItemRow}>
                            <span
                              className={cn(
                                styles.dot,
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
                    <SelectTrigger className={styles.propertyTrigger}>
                      <span
                        className={cn(
                          styles.dot,
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
                          <div className={styles.selectItemRow}>
                            <span
                              className={cn(
                                styles.dot,
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

                <div className={styles.divider} />

                {/* Start Date */}
                <PropertyRow icon={CalendarDays} label="Start">
                  <DatePickerField
                    value={parsedStartDate}
                    onChange={(d) => setStartDate(d ? d.toISOString() : undefined)}
                  />
                </PropertyRow>

                {/* Due Date */}
                <PropertyRow icon={CalendarClock} label="Due">
                  <DatePickerField
                    value={parsedDueDate}
                    onChange={(d) => setDueDate(d ? d.toISOString() : undefined)}
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
  if (userIds.length === 1) return <span className={styles.truncate}>{firstUser?.name ?? "..."}</span>;
  return <span className={styles.truncate}>{userIds.length} assignees</span>;
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
      <Check className={cn(styles.checkIcon, styles.checkVisible)} />
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
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={styles.assigneeTrigger}
        >
          {value.length > 0 ? (
            <>
              <div className={styles.avatarStack}>
                {value.slice(0, 3).map((id) => (
                  <AssigneeAvatar key={id} userId={id} />
                ))}
              </div>
              <AssigneeLabel userIds={value} />
              <X
                className={styles.clearIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            </>
          ) : (
            <>
              <span className={styles.unassignedText}>Unassigned</span>
              <ChevronsUpDown className={styles.chevronIcon} />
            </>
          )}
        </button>
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
                        styles.checkIcon,
                        isSelected ? styles.checkVisible : styles.checkHidden,
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

