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
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, X, ChevronsUpDown } from "lucide-react";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import type { Task, UpdateTaskInput } from "@/types/task";
import { useSearchUsers, useUser } from "@/hooks/use-users";
import { useLabels } from "@/hooks/use-labels";
import { LabelCombobox } from "@/components/shared/label-combobox";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { cn } from "@/lib/utils";
import styles from "./task-detail-fields.module.css";

interface UpdateTaskMutation {
  mutate: (
    vars: { id: string; input: UpdateTaskInput },
    opts?: { onSuccess?: (data: Task) => void },
  ) => void;
  isLoading: boolean;
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
        styles.saveIndicator,
        visible ? styles.saveVisible : styles.saveHidden,
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
      <div className={styles.titleRow}>
        <div
          className={cn(
            styles.titleAccent,
            STATUS_DOT_COLORS[status],
          )}
        />
        <div className={styles.titleInner}>
          <h2
            className={styles.titleText}
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
    <div className={styles.titleRow}>
      <div
        className={cn(
          styles.titleAccent,
          STATUS_DOT_COLORS[status],
        )}
      />
      <div className={styles.titleInner}>
        <Input
          autoFocus
          className={styles.titleInput}
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
      <div className={styles.descriptionRow}>
        <div
          className={styles.descriptionClickable}
          onClick={() => setEditing(true)}
        >
          {value ? (
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: value }}
            />
          ) : (
            <p className={styles.descriptionPlaceholder}>
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
      className={styles.descriptionEditing}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <RichTextEditor
        content={draft}
        onChange={setDraft}
        placeholder="Add a description..."
      />
      <div className={styles.descriptionActions}>
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
    <div className={styles.selectRow}>
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
        <SelectTrigger className={styles.propertyTrigger}>
          <span
            className={cn(
              styles.dot,
              STATUS_DOT_COLORS[value],
            )}
          />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]).map(
            ([key, config]) => (
              <SelectItem key={key} value={key}>
                <div className={styles.selectItemRow}>
                  <span className={cn(styles.dot, STATUS_DOT_COLORS[key])} />
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
    <div className={styles.selectRow}>
      <Select
        value={value}
        onValueChange={(v) => {
          updateTask.mutate(
            { id: taskId, input: { priority: v as TaskPriority } },
            { onSuccess: () => flash() },
          );
        }}
      >
        <SelectTrigger className={styles.propertyTrigger}>
          <span
            className={cn(
              styles.dot,
              PRIORITY_DOT_COLORS[value],
            )}
          />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(TASK_PRIORITY_CONFIG) as [TaskPriority, { label: string; color: string; icon: string }][]).map(
            ([key, config]) => (
              <SelectItem key={key} value={key}>
                <div className={styles.selectItemRow}>
                  <span className={cn(styles.dot, PRIORITY_DOT_COLORS[key])} />
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
  updateTask: UpdateTaskMutation;
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

export function AssigneeSelect({
  taskId,
  value,
  updateTask,
}: AssigneeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { saved, flash } = useSaveIndicator();
  const { data: searchResults } = useSearchUsers(search);

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
    <div className={styles.selectRow}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
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
                    handleClear();
                  }}
                />
              </>
            ) : (
              <>
                <span className={styles.unassignedText}>Unassigned</span>
                <ChevronsUpDown className={styles.chevronIcon} />
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
                {!search && value.map((id) => (
                  <SelectedAssigneeItem
                    key={id}
                    userId={id}
                    onDeselect={() => handleToggle(id)}
                  />
                ))}
                {searchResults?.filter((u) => !value.includes(u.id)).map((user) => {
                  const initials = user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);
                  return (
                    <CommandItem
                      key={user.id}
                      value={user.id}
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
  const { saved, flash } = useSaveIndicator();
  const date = value ? new Date(value) : undefined;

  return (
    <div className={styles.selectRow}>
      <DatePickerField
        value={date}
        onChange={(d) => {
          updateTask.mutate(
            { id: taskId, input: { startDate: d ? d.toISOString() : null } },
            { onSuccess: () => flash() },
          );
        }}
      />
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
  const { saved, flash } = useSaveIndicator();
  const { data: labels = [] } = useLabels(projectId);

  const handleChange = (newIds: string[]) => {
    updateTask.mutate(
      { id: taskId, input: { labelIds: newIds } },
      { onSuccess: () => flash() },
    );
  };

  return (
    <div className={styles.labelRow}>
      <LabelCombobox
        value={value}
        labels={labels}
        onChange={handleChange}
        projectId={projectId}
      />
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
  const { saved, flash } = useSaveIndicator();
  const date = value ? new Date(value) : undefined;

  return (
    <div className={styles.selectRow}>
      <DatePickerField
        value={date}
        onChange={(d) => {
          updateTask.mutate(
            { id: taskId, input: { dueDate: d ? d.toISOString() : null } },
            { onSuccess: () => flash() },
          );
        }}
      />
      <SaveIndicator visible={saved} />
    </div>
  );
}
