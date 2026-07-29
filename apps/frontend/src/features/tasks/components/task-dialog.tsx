import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  /** Create mode: target module. */
  moduleId: string;
  /** Edit mode: existing task (omit for create). */
  task?: Task;
  memberIds: string[];
  userMap: Record<string, AppUser>;
}

export function TaskDialog({
  open,
  onOpenChange,
  moduleId,
  task,
  memberIds,
  userMap,
}: Props) {
  const create = useCreateTask();
  const update = useUpdateTask();
  const editing = !!task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

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
  }, [open, task]);

  const pending = create.isPending || update.isPending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const onError = (err: { message: string }) =>
      toast.error(err.message || "Failed to save task");

    if (editing) {
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
          labelIds: [],
        },
        { onSuccess: () => onOpenChange(false), onError },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
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
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
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
              <span className="text-sm text-muted-foreground">Start</span>
              <DatePickerField value={startDate} onChange={setStartDate} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Due</span>
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
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
