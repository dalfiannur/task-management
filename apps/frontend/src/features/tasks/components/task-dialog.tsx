import { useEffect, useId, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { DatePickerField } from "@/components/shared/date-picker-field";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import { LabelCombobox } from "@/features/labels";
import { CommentThread } from "@/features/comments";
import { TaskAttachments } from "@/features/media";
import type { Task, TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "../config";
import { statusToProto, priorityToProto } from "../api/mappers";
import { useCreateTask, useUpdateTask } from "../api/hooks";
import { buildHierarchy } from "../task-graph";
import { AssigneePicker } from "./assignee-picker";
import { SubtaskSection } from "./subtask-section";
import { DependencyPicker } from "./dependency-picker";

function isoToDate(v?: string): Date | undefined {
  return v ? new Date(v) : undefined;
}
function dateToIso(d: Date | undefined): string | undefined {
  return d ? format(d, "yyyy-MM-dd") : undefined;
}

/**
 * One labelled control in the properties sidebar. The caption is a `<span>`
 * rather than a `<Label>` because none of these controls is a native form
 * element with an id to point `htmlFor` at (they are Radix triggers), so the
 * name is attached with `role="group" + aria-labelledby` instead.
 */
function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2" role="group" aria-labelledby={id}>
      <span id={id} className="text-label block">
        {label}
      </span>
      {children}
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  /** Create mode: target module. */
  moduleId: string;
  /** Edit mode: existing task (omit for create, or while a URL-driven fetch
   *  for it is still in flight — see `editing`). */
  task?: Task;
  /**
   * Whether this dialog addresses an existing task, independent of whether
   * `task` has arrived yet. Defaults to `!!task` for the state-driven create
   * dialog (which never has a task to wait on). The URL-driven edit dialog
   * passes this explicitly as `!!taskParam`: while a deep-linked task is
   * still being fetched, `task` is `undefined` but the *intent* is still
   * "edit" — deriving mode from `!!task` alone would show a blank,
   * submittable "New task" form for that whole window instead.
   */
  editing?: boolean;
  memberIds: string[];
  userMap: Record<string, AppUser>;
  /** Comment id to scroll to and highlight (from a deep link). Edit mode only. */
  highlightCommentId?: string;
  /**
   * The project's full task list, for the subtask and dependency sections
   * (edit mode only — a task being created has no id to hang either on).
   */
  tasks: Task[];
  /** Opens another task in the URL-addressed dialog (`?task=`) — used to
   *  navigate to a subtask, or from a subtask to its parent. */
  onOpenTask: (id: string) => void;
}

export function TaskDialog({
  open,
  onOpenChange,
  projectId,
  moduleId,
  task,
  editing: editingProp,
  memberIds,
  userMap,
  highlightCommentId,
  tasks,
  onOpenTask,
}: Props) {
  const create = useCreateTask(projectId);
  const update = useUpdateTask();
  const editing = editingProp ?? !!task;
  // Edit intent confirmed, but the object hasn't arrived yet. The create
  // path must stay unreachable through this whole window, not just visually
  // — see onSubmit and the loading branch below.
  const loading = editing && !task;
  // The submit button lives in the sticky footer, outside the <form> — bound
  // back to it by id. Generated per instance because the create dialog and
  // the URL-driven edit dialog can be mounted at the same time, and a
  // duplicated id would point one footer at the other dialog's form.
  const formId = useId();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);

  // Reset the form whenever the dialog opens (for create or a specific task).
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setStatus(task?.status ?? "todo");
    setPriority(task?.priority ?? "none");
    setStartDate(isoToDate(task?.startDate));
    setDueDate(isoToDate(task?.dueDate));
    setAssigneeIds(task?.assigneeIds ?? []);
    setLabelIds(task?.labelIds ?? []);
  }, [open, task]);

  const pending = create.isPending || update.isPending;

  // Subtask + dependency sections (edit mode only — a task being created has
  // no id to hang either on). A subtask can never itself have children (the
  // one-level rule), so `subtasks` is only meaningful when `task` isn't one.
  const { childrenOf } = buildHierarchy(tasks);
  const subtasks = task ? childrenOf[task.id] ?? [] : [];
  const parentTask = task?.parentId
    ? tasks.find((t) => t.id === task.parentId)
    : undefined;
  // Blocked-by candidates: every other task in the project, minus this
  // task's own subtasks (a subtask cannot block its own parent's schedule).
  const dependencyCandidates = task
    ? tasks.filter((t) => t.id !== task.id && t.parentId !== task.id)
    : [];
  // Subtasks, dependencies and comments all hang off a saved task, so in
  // create mode the left column is just the form and the sidebar only needs
  // to span one grid row.
  const hasDetails = editing && !!task;

  function onDependencyChange(blockedByIds: string[]) {
    if (!task) return;
    update.mutate(
      { id: task.id, blockedByIds: { values: blockedByIds } },
      {
        onError: (err) =>
          toast.error(err.message || "Failed to update dependencies"),
      },
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const onError = (err: { message: string }) =>
      toast.error(err.message || "Failed to save task");

    if (editing) {
      // Still loading (or, defensively, closed out from under us) — there is
      // nothing to submit yet. The form isn't rendered while `loading` is
      // true (see below), so this is a belt-and-suspenders guard, not the
      // primary defense: it's what stops `editing` ever falling through to
      // the create branch below.
      if (!task) return;
      update.mutate(
        {
          id: task.id,
          title: title.trim(),
          description,
          status: statusToProto(status),
          priority: priorityToProto(priority),
          startDate: dateToIso(startDate),
          dueDate: dateToIso(dueDate),
          assigneeIds: { values: assigneeIds },
          labelIds: { values: labelIds },
        },
        { onSuccess: () => onOpenChange(false), onError },
      );
    } else {
      // Closed straight away: useCreateTask puts the row in the list
      // optimistically, and reports (and rolls back) a failure itself — so
      // there's nothing left for this dialog to wait on.
      onOpenChange(false);
      create.mutate({
        moduleId,
        title: title.trim(),
        description: description || undefined,
        status: statusToProto(status),
        priority: priorityToProto(priority),
        startDate: dateToIso(startDate),
        dueDate: dateToIso(dueDate),
        assigneeIds,
        labelIds,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Padding moves off the content box and onto each band, so the header
          and footer rules span the full width and the middle band is the only
          thing that scrolls. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-border-subtle px-6 py-4">
          {/* Demoted to an eyebrow: the task's own title is the heading of
              this dialog now, so this line only names the mode. */}
          <DialogTitle className="text-xs leading-[1.6] font-semibold tracking-[0.08em] text-text-subtle uppercase">
            {editing ? "Edit task" : "New task"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          // Edit intent is already known here — only the data isn't in yet.
          // Rendering the real (empty) form in this window is what let a
          // deep link submit as a create; a placeholder with no submit
          // control removes that path entirely rather than just disabling it.
          <div
            className="min-h-0 flex-1 overflow-y-auto p-6"
            aria-busy="true"
            aria-label="Loading task"
          >
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="space-y-4">
                <Skeleton className="h-8 w-2/3 rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </div>
              <div className="space-y-4 sm:border-l sm:border-border-subtle sm:pl-6">
                <Skeleton className="h-8 w-32 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
                <Skeleton className="h-8 w-36 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_16rem]">
                {/* Left column, row 1 — the editable body of the task. */}
                <form
                  id={formId}
                  onSubmit={onSubmit}
                  className="space-y-4 sm:col-start-1 sm:row-start-1"
                >
                  {/* Borderless on purpose: this is the dialog's real heading,
                      so it is styled as one and reveals its input chrome only
                      on focus (the base-layer focus ring). */}
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="Task title"
                    placeholder="Task title"
                    autoFocus
                    required
                    className="w-full bg-transparent text-xl font-semibold text-text placeholder:text-text-subtle"
                  />
                  <div className="space-y-2" role="group" aria-labelledby={`${formId}-desc`}>
                    <span id={`${formId}-desc`} className="text-label block">
                      Description
                    </span>
                    <RichTextEditor
                      value={description}
                      onChange={setDescription}
                      placeholder="Describe the task…"
                    />
                  </div>
                </form>

                {/* Right column — properties. Spans both rows when the left
                    column has a details block, so the rule runs the full
                    height of the content rather than stopping mid-way. */}
                <aside
                  className={cn(
                    "space-y-4 sm:col-start-2 sm:row-start-1 sm:border-l sm:border-border-subtle sm:pl-6",
                    hasDetails && "sm:row-span-2",
                  )}
                >
                  <Property label="Status">
                    <Select
                      value={status}
                      onValueChange={(v) => setStatus(v as TaskStatus)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {TASK_STATUS_CONFIG[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Property>
                  <Property label="Priority">
                    <Select
                      value={priority}
                      onValueChange={(v) => setPriority(v as TaskPriority)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {TASK_PRIORITY_CONFIG[p].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Property>
                  <Property label="Start date">
                    <DatePickerField value={startDate} onChange={setStartDate} />
                  </Property>
                  <Property label="Due date">
                    <DatePickerField
                      value={dueDate}
                      onChange={setDueDate}
                      minDate={startDate}
                    />
                  </Property>
                  <Property label="Assignees">
                    <AssigneePicker
                      memberIds={memberIds}
                      userMap={userMap}
                      value={assigneeIds}
                      onChange={setAssigneeIds}
                    />
                  </Property>
                  <Property label="Labels">
                    <LabelCombobox
                      projectId={projectId}
                      value={labelIds}
                      onChange={setLabelIds}
                    />
                  </Property>
                </aside>

                {/* Left column, row 2 — everything that saves itself and so
                    sits outside the form: relations and the comment thread. */}
                {hasDetails && task && (
                  <div className="space-y-6 sm:col-start-1 sm:row-start-2">
                    <div className="space-y-4 border-t border-border-subtle pt-6">
                      {task.parentId ? (
                        // The one-level rule made visible: a subtask never gets
                        // its own "add subtask" UI (the backend would reject
                        // it) — just a way back to the task that owns it.
                        // `parentTask` can be momentarily missing from `tasks`
                        // (e.g. the parent hasn't loaded yet); still honor the
                        // "no subtask UI on a subtask" rule rather than falling
                        // through to SubtaskSection.
                        parentTask ? (
                          <button
                            type="button"
                            onClick={() => onOpenTask(parentTask.id)}
                            className="text-sm text-brand-text hover:underline"
                          >
                            ← Subtask of “{parentTask.title}”
                          </button>
                        ) : (
                          <p className="text-sm text-text-muted">
                            This is a subtask.
                          </p>
                        )
                      ) : (
                        <SubtaskSection
                          projectId={projectId}
                          parent={task}
                          children={subtasks}
                          onOpenTask={onOpenTask}
                        />
                      )}
                      <DependencyPicker
                        task={task}
                        candidates={dependencyCandidates}
                        onChange={onDependencyChange}
                      />
                      <TaskAttachments
                        taskId={task.id}
                        projectId={projectId}
                      />
                    </div>
                    <div className="border-t border-border-subtle pt-6">
                      <CommentThread
                        taskId={task.id}
                        projectId={projectId}
                        highlightCommentId={highlightCommentId}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t border-border-subtle px-6 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form={formId}
                disabled={pending || !title.trim()}
              >
                {pending ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
