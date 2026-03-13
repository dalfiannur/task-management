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
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import type { Task, UpdateTaskInput } from "@/types/task";
import { useLabels } from "@/hooks/use-labels";
import { LabelCombobox } from "@/components/shared/label-combobox";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { AssigneeCombobox } from "@/components/shared/assignee-combobox";
import { cn } from "@/lib/utils";

interface UpdateTaskMutation {
  mutate: (
    vars: { id: string; input: UpdateTaskInput },
    opts?: { onSuccess?: (data: Task) => void },
  ) => void;
  isLoading: boolean;
}

const STATUS_PILL_CLASSES: Record<TaskStatus, string> = {
  todo: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
  done: "bg-emerald-400",
  cancelled: "bg-red-400",
};

const PRIORITY_PILL_CLASSES: Record<TaskPriority, string> = {
  none: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
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
      <div className="flex gap-2.5 items-start">
        <div
          className={cn(
            "w-1 shrink-0 rounded-full mt-1 self-stretch transition-colors",
            STATUS_DOT_COLORS[status],
          )}
        />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2
            className="text-2xl font-bold tracking-tight cursor-pointer rounded-md px-1 -mx-1 hover:bg-muted/50 transition-colors"
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
    <div className="flex gap-2.5 items-start">
      <div
        className={cn(
          "w-1 shrink-0 rounded-full mt-1 self-stretch transition-colors",
          STATUS_DOT_COLORS[status],
        )}
      />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input
          autoFocus
          className="text-2xl font-bold tracking-tight h-auto py-1 px-1 -mx-1"
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
          className="flex-1 cursor-pointer rounded-lg p-2 -mx-1 hover:bg-muted/30 transition-colors min-h-9"
          onClick={() => setEditing(true)}
        >
          {value ? (
            <div
              className="prose text-muted-foreground leading-relaxed"
              dangerouslySetInnerHTML={{ __html: value }}
            />
          ) : (
            <p className="text-sm leading-5 text-muted-foreground/40 italic">
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
      className="space-y-1.5"
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <RichTextEditor
        content={draft}
        onChange={setDraft}
        placeholder="Add a description..."
      />
      <div className="flex items-center gap-1.5 justify-end">
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
        <SelectTrigger
          className={cn(
            "h-7 text-xs leading-4 font-bold border-0 shadow-none px-3 w-auto gap-1 rounded-full transition-colors [&_svg:last-child]:size-3",
            STATUS_PILL_CLASSES[value],
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
        <SelectTrigger
          className={cn(
            "h-7 text-xs leading-4 font-bold border-0 shadow-none px-3 w-auto gap-1 rounded-full transition-colors [&_svg:last-child]:size-3",
            PRIORITY_PILL_CLASSES[value],
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
      <SaveIndicator visible={saved} />
    </div>
  );
}

// --- Assignee Select (wraps shared AssigneeCombobox with mutation + SaveIndicator) ---

interface AssigneeSelectProps {
  taskId: string;
  value: string[];
  updateTask: UpdateTaskMutation;
}

export function AssigneeSelect({
  taskId,
  value,
  updateTask,
}: AssigneeSelectProps) {
  const { saved, flash } = useSaveIndicator();

  return (
    <div className="flex items-center gap-1">
      <AssigneeCombobox
        value={value}
        onChange={(newIds) => {
          updateTask.mutate(
            { id: taskId, input: { assigneeIds: newIds } },
            { onSuccess: () => flash() },
          );
        }}
      />
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
    <div className="flex items-center gap-1">
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
    <div className="flex items-center gap-1">
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
    <div className="flex items-center gap-1">
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
