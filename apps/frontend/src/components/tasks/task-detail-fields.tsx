import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Calendar as CalendarIcon, X, ChevronsUpDown } from "lucide-react";
import { format } from "date-fns";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import type { User } from "@/types/task";
import type { UseMutationResult } from "@tanstack/react-query";
import type { Task, UpdateTaskInput } from "@/types/task";
import { useLabels } from "@/hooks/use-labels";
import { cn } from "@/lib/utils";

type UpdateTaskMutation = UseMutationResult<
  Task,
  Error,
  { id: string; input: UpdateTaskInput }
>;

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

// --- Save indicator hook & component ---

function useSaveIndicator() {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback(() => {
    setSaved(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { saved, flash };
}

function SaveIndicator({ visible }: { visible: boolean }) {
  return (
    <Check
      className={cn(
        "size-3.5 text-green-500 transition-opacity duration-300 shrink-0",
        visible ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

// --- Editable Title ---

interface EditableTitleProps {
  taskId: string;
  value: string;
  status: TaskStatus;
  updateTask: UpdateTaskMutation;
}

export function EditableTitle({
  taskId,
  value,
  status,
  updateTask,
}: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { saved, flash } = useSaveIndicator();

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      return;
    }
    updateTask.mutate(
      { id: taskId, input: { title: trimmed } },
      { onSuccess: () => flash() },
    );
  };

  if (!editing) {
    return (
      <div className="flex gap-3 items-start">
        <div
          className={cn(
            "w-1 shrink-0 rounded-full mt-1 self-stretch transition-colors",
            STATUS_DOT_COLORS[status],
          )}
        />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2
            className="text-xl font-bold font-display tracking-tight cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
            onClick={() => setEditing(true)}
          >
            {value}
          </h2>
          <SaveIndicator visible={saved} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      <div
        className={cn(
          "w-1 shrink-0 rounded-full mt-1 self-stretch transition-colors",
          STATUS_DOT_COLORS[status],
        )}
      />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input
          autoFocus
          className="text-xl font-bold font-display tracking-tight h-auto py-1 px-1 -mx-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
        />
        <SaveIndicator visible={saved} />
      </div>
    </div>
  );
}

// --- Editable Description ---

interface EditableDescriptionProps {
  taskId: string;
  value?: string;
  updateTask: UpdateTaskMutation;
}

export function EditableDescription({
  taskId,
  value,
  updateTask,
}: EditableDescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const { saved, flash } = useSaveIndicator();

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    updateTask.mutate(
      { id: taskId, input: { description: trimmed || undefined } },
      { onSuccess: () => flash() },
    );
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div
          className="flex-1 cursor-pointer hover:bg-muted/30 rounded-lg px-3 py-2.5 -mx-1 transition-colors min-h-[2.5rem]"
          onClick={() => setEditing(true)}
        >
          {value ? (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: value }}
            />
          ) : (
            <p className="text-sm text-muted-foreground/40 italic">
              Add a description...
            </p>
          )}
        </div>
        <SaveIndicator visible={saved} />
      </div>
    );
  }

  return (
    <div
      className="space-y-2"
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <RichTextEditor
        content={draft}
        onChange={setDraft}
        placeholder="Add a description..."
      />
      <div className="flex items-center gap-2 justify-end">
        <SaveIndicator visible={saved} />
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

// --- Status Select ---

interface StatusSelectProps {
  taskId: string;
  value: TaskStatus;
  startDate?: string;
  updateTask: UpdateTaskMutation;
}

export function StatusSelect({ taskId, value, startDate, updateTask }: StatusSelectProps) {
  const { saved, flash } = useSaveIndicator();

  return (
    <div className="flex items-center gap-1">
      <Select
        value={value}
        onValueChange={(v) => {
          const newStatus = v as TaskStatus;
          const input: UpdateTaskInput = { status: newStatus };
          if (newStatus === "in_progress" && !startDate) {
            input.startDate = new Date().toISOString();
          }
          updateTask.mutate(
            { id: taskId, input },
            { onSuccess: () => flash() },
          );
        }}
      >
        <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent hover:bg-muted/50 transition-colors px-2 w-auto gap-1.5 [&>svg:last-child]:size-3">
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              STATUS_DOT_COLORS[value],
            )}
          />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]).map(
            ([key, config]) => (
              <SelectItem key={key} value={key}>
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", STATUS_DOT_COLORS[key])} />
                  {config.label}
                </div>
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <SaveIndicator visible={saved} />
    </div>
  );
}

// --- Priority Select ---

interface PrioritySelectProps {
  taskId: string;
  value: TaskPriority;
  updateTask: UpdateTaskMutation;
}

export function PrioritySelect({
  taskId,
  value,
  updateTask,
}: PrioritySelectProps) {
  const { saved, flash } = useSaveIndicator();

  return (
    <div className="flex items-center gap-1">
      <Select
        value={value}
        onValueChange={(v) => {
          updateTask.mutate(
            { id: taskId, input: { priority: v as TaskPriority } },
            { onSuccess: () => flash() },
          );
        }}
      >
        <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent hover:bg-muted/50 transition-colors px-2 w-auto gap-1.5 [&>svg:last-child]:size-3">
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              PRIORITY_DOT_COLORS[value],
            )}
          />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(TASK_PRIORITY_CONFIG) as [TaskPriority, { label: string; color: string; icon: string }][]).map(
            ([key, config]) => (
              <SelectItem key={key} value={key}>
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", PRIORITY_DOT_COLORS[key])} />
                  {config.label}
                </div>
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <SaveIndicator visible={saved} />
    </div>
  );
}

// --- Assignee Combobox ---

interface AssigneeSelectProps {
  taskId: string;
  value: string[];
  users: User[];
  updateTask: UpdateTaskMutation;
}

export function AssigneeSelect({
  taskId,
  value,
  users,
  updateTask,
}: AssigneeSelectProps) {
  const [open, setOpen] = useState(false);
  const { saved, flash } = useSaveIndicator();
  const selectedUsers = users.filter((u) => value.includes(u.id));

  const handleToggle = (userId: string) => {
    const newIds = value.includes(userId)
      ? value.filter((id) => id !== userId)
      : [...value, userId];
    updateTask.mutate(
      { id: taskId, input: { assigneeIds: newIds.length > 0 ? newIds : null } },
      { onSuccess: () => flash() },
    );
  };

  const handleClear = () => {
    updateTask.mutate(
      { id: taskId, input: { assigneeIds: null } },
      { onSuccess: () => flash() },
    );
  };

  return (
    <div className="flex items-center gap-1">
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
                    handleClear();
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
                      onSelect={() => handleToggle(user.id)}
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
      <SaveIndicator visible={saved} />
    </div>
  );
}

// --- Start Date Picker ---

interface StartDatePickerProps {
  taskId: string;
  value?: string;
  updateTask: UpdateTaskMutation;
}

export function StartDatePicker({
  taskId,
  value,
  updateTask,
}: StartDatePickerProps) {
  const [open, setOpen] = useState(false);
  const { saved, flash } = useSaveIndicator();
  const date = value ? new Date(value) : undefined;

  const saveDate = (newDate: Date | undefined) => {
    updateTask.mutate(
      { id: taskId, input: { startDate: newDate ? newDate.toISOString() : null } },
      { onSuccess: () => flash() },
    );
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-3" />
            {date ? format(date, "MMM d, yyyy") : "Set date"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => saveDate(d)}
            initialFocus
          />
          {date && (
            <div className="p-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground text-xs h-7"
                onClick={() => saveDate(undefined)}
              >
                <X className="mr-1 size-3" />
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <SaveIndicator visible={saved} />
    </div>
  );
}

// --- Label Select ---

interface LabelSelectProps {
  taskId: string;
  projectId: string;
  value: string[];
  updateTask: UpdateTaskMutation;
}

export function LabelSelect({
  taskId,
  projectId,
  value,
  updateTask,
}: LabelSelectProps) {
  const [open, setOpen] = useState(false);
  const { saved, flash } = useSaveIndicator();
  const { data: labels = [] } = useLabels(projectId);
  const selectedLabels = labels.filter((l) => value.includes(l.id));

  const handleToggle = (labelId: string) => {
    const newIds = value.includes(labelId)
      ? value.filter((id) => id !== labelId)
      : [...value, labelId];
    updateTask.mutate(
      { id: taskId, input: { labelIds: newIds } },
      { onSuccess: () => flash() },
    );
  };

  const handleClear = () => {
    updateTask.mutate(
      { id: taskId, input: { labelIds: [] } },
      { onSuccess: () => flash() },
    );
  };

  return (
    <div className="flex items-center gap-1">
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
                    handleClear();
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
                      onSelect={() => handleToggle(label.id)}
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
      <SaveIndicator visible={saved} />
    </div>
  );
}

// --- Due Date Picker ---

interface DueDatePickerProps {
  taskId: string;
  value?: string;
  updateTask: UpdateTaskMutation;
}

export function DueDatePicker({
  taskId,
  value,
  updateTask,
}: DueDatePickerProps) {
  const [open, setOpen] = useState(false);
  const { saved, flash } = useSaveIndicator();
  const date = value ? new Date(value) : undefined;

  const saveDate = (newDate: Date | undefined) => {
    updateTask.mutate(
      { id: taskId, input: { dueDate: newDate ? newDate.toISOString() : null } },
      { onSuccess: () => flash() },
    );
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-3" />
            {date ? format(date, "MMM d, yyyy") : "Set date"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => saveDate(d)}
            initialFocus
          />
          {date && (
            <div className="p-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground text-xs h-7"
                onClick={() => saveDate(undefined)}
              >
                <X className="mr-1 size-3" />
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <SaveIndicator visible={saved} />
    </div>
  );
}
