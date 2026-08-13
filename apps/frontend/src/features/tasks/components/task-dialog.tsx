import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { AppUser } from "@/features/auth";
import { LabelCombobox } from "@/features/labels";
import { CommentThread } from "@/features/comments";
import type { Task, TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "../config";
import { statusToProto, priorityToProto } from "../api/mappers";
import { useCreateTask, useUpdateTask } from "../api/hooks";
import { AssigneePicker } from "./assignee-picker";

function isoToDate(v?: string): Date | undefined {
  return v ? new Date(v) : undefined;
}
function dateToIso(d: Date | undefined): string | undefined {
  return d ? format(d, "yyyy-MM-dd") : undefined;
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
}: Props) {
  const create = useCreateTask();
  const update = useUpdateTask();
  const editing = editingProp ?? !!task;
  // Edit intent confirmed, but the object hasn't arrived yet. The create
  // path must stay unreachable through this whole window, not just visually
  // — see onSubmit and the loading branch below.
  const loading = editing && !task;

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
      create.mutate(
        {
          moduleId,
          title: title.trim(),
          description: description || undefined,
          status: statusToProto(status),
          priority: priorityToProto(priority),
          startDate: dateToIso(startDate),
          dueDate: dateToIso(dueDate),
          assigneeIds,
          labelIds,
        },
        { onSuccess: () => onOpenChange(false), onError },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        {loading ? (
          // Edit intent is already known here — only the data isn't in yet.
          // Rendering the real (empty) form in this window is what let a
          // deep link submit as a create; a placeholder with no submit
          // control removes that path entirely rather than just disabling it.
          <div className="space-y-4 py-1" aria-busy="true" aria-label="Loading task">
            <Skeleton className="h-9 w-2/3 rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-9 rounded-lg" />
              <Skeleton className="h-9 rounded-lg" />
            </div>
            <Skeleton className="h-9 w-40 rounded-lg" />
          </div>
        ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Describe the task…"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TaskStatus)}
              >
                <SelectTrigger>
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
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
              >
                <SelectTrigger>
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
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">Start</span>
              <DatePickerField value={startDate} onChange={setStartDate} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">Due</span>
              <DatePickerField
                value={dueDate}
                onChange={setDueDate}
                minDate={startDate}
              />
            </div>
            <AssigneePicker
              memberIds={memberIds}
              userMap={userMap}
              value={assigneeIds}
              onChange={setAssigneeIds}
            />
            <LabelCombobox
              projectId={projectId}
              value={labelIds}
              onChange={setLabelIds}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
        )}
        {editing && task && (
          <>
            <div className="my-2 border-t border-border-subtle" />
            <CommentThread
              taskId={task.id}
              projectId={projectId}
              highlightCommentId={highlightCommentId}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
