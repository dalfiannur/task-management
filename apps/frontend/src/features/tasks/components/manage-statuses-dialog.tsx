import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "sedjiwa-ui";
import { ColorSwatches, LABEL_COLORS } from "@/features/labels";
import { TASK_STATUSES, type Task, type TaskStatus, type WorkflowStatus } from "../types";
import { TASK_STATUS_CONFIG } from "../config";
import { statusToProto } from "../api/mappers";
import {
  useCreateStatus,
  useDeleteStatus,
  useReorderStatuses,
  useStatuses,
  useUpdateStatus,
} from "../api/hooks";
import { StatusDot } from "./task-badges";

/** Categories a project must keep one status of — mirrors the server rule. */
const REQUIRED: TaskStatus[] = ["todo", "done"];

function CategorySelect({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (c: TaskStatus) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TaskStatus)}>
      <SelectTrigger className="h-8 w-36" aria-label="Category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((c) => (
          <SelectItem key={c} value={c}>
            {TASK_STATUS_CONFIG[c].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusRow({
  status,
  statuses,
  taskCount,
  index,
  onMove,
}: {
  status: WorkflowStatus;
  statuses: WorkflowStatus[];
  taskCount: number;
  index: number;
  onMove: (from: number, to: number) => void;
}) {
  const update = useUpdateStatus();
  const del = useDeleteStatus();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color);
  const [category, setCategory] = useState(status.category);
  const others = statuses.filter((s) => s.id !== status.id);
  const [replacementId, setReplacementId] = useState("");
  // The last To Do / Done status cannot leave its category, by delete or by
  // re-categorising — the server refuses both; say so before the round-trip.
  const lastOfKind =
    REQUIRED.includes(status.category) &&
    !others.some((s) => s.category === status.category);

  function startEdit() {
    setName(status.name);
    setColor(status.color);
    setCategory(status.category);
    setMode("edit");
  }

  function save() {
    if (!name.trim()) return;
    update.mutate(
      {
        id: status.id,
        name: name.trim(),
        color,
        category: statusToProto(category),
      },
      {
        onSuccess: () => setMode("view"),
        onError: (e) => toast.error(e.message || "Update failed"),
      },
    );
  }

  function remove() {
    del.mutate(
      { id: status.id, replacementId: replacementId || undefined },
      {
        onSuccess: () => toast.success(`Status "${status.name}" deleted.`),
        onError: (e) => toast.error(e.message || "Delete failed"),
      },
    );
  }

  if (mode === "edit") {
    return (
      <li className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex gap-2">
          <Input.Root>
            <Input.Field
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Status name"
              autoFocus
            />
          </Input.Root>
          <CategorySelect value={category} onChange={setCategory} />
        </div>
        {lastOfKind && category !== status.category && (
          <p className="text-xs text-destructive">
            This is the project's only{" "}
            {TASK_STATUS_CONFIG[status.category].label.toLowerCase()} status.
          </p>
        )}
        <ColorSwatches value={color} onChange={setColor} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={
              update.isPending ||
              !name.trim() ||
              (lastOfKind && category !== status.category)
            }
          >
            Save
          </Button>
        </div>
      </li>
    );
  }

  if (mode === "delete") {
    return (
      <li className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm">
          Delete <span className="font-medium">{status.name}</span>?
          {taskCount > 0 &&
            ` Its ${taskCount} task${taskCount === 1 ? "" : "s"} move to:`}
        </p>
        {taskCount > 0 && (
          <Select value={replacementId} onValueChange={setReplacementId}>
            <SelectTrigger className="h-8 w-full" aria-label="Move tasks to">
              <SelectValue placeholder="Choose a status" />
            </SelectTrigger>
            <SelectContent>
              {others.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <StatusDot status={s.category} color={s.color} className="mr-1.5 h-2 w-2" />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={remove}
            disabled={del.isPending || (taskCount > 0 && !replacementId)}
          >
            Delete
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-accent">
      <StatusDot status={status.category} color={status.color} className="h-2.5 w-2.5" />
      <span className="truncate text-sm font-medium">{status.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {TASK_STATUS_CONFIG[status.category].label}
      </span>
      <span className="text-num shrink-0 text-xs text-muted-foreground">
        · {taskCount}
      </span>
      <div className="flex-1" />
      <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move ${status.name} up`}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={index === statuses.length - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move ${status.name} down`}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={startEdit}
          aria-label={`Edit ${status.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={lastOfKind}
          title={lastOfKind ? "A project needs at least one status of this category" : undefined}
          onClick={() => {
            setReplacementId("");
            setMode("delete");
          }}
          aria-label={`Delete ${status.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

/** The project's workflow: add, rename, recolour, re-categorise, reorder and
 *  delete its task statuses. The board's columns follow this list. */
export function ManageStatusesDialog({
  projectId,
  tasks,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** The project's tasks, for the per-status counts. */
  tasks: Task[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { statuses } = useStatuses(projectId);
  const create = useCreateStatus();
  const reorder = useReorderStatuses();
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [category, setCategory] = useState<TaskStatus>("in_progress");

  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.statusId, (counts.get(t.statusId) ?? 0) + 1);

  function add() {
    if (!name.trim()) return;
    create.mutate(
      { projectId, name: name.trim(), color, category: statusToProto(category) },
      {
        onSuccess: () => {
          setName("");
          setColor(LABEL_COLORS[0]);
        },
        onError: (e) => toast.error(e.message || "Create failed"),
      },
    );
  }

  function move(from: number, to: number) {
    const ids = statuses.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorder.mutate(
      { projectId, statusIds: ids },
      { onError: (e) => toast.error(e.message || "Reorder failed") },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage statuses</DialogTitle>
          <DialogDescription>
            The board shows one column per status, in this order. The category
            decides what counts as open, done or cancelled in progress and
            reports.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-80 space-y-0.5 overflow-y-auto">
          {statuses.map((s, i) => (
            <StatusRow
              key={s.id}
              status={s}
              statuses={statuses}
              taskCount={counts.get(s.id) ?? 0}
              index={i}
              onMove={move}
            />
          ))}
        </ul>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex gap-2">
            <Input.Root>
              <Input.Field
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New status, e.g. Review"
                aria-label="New status name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </Input.Root>
            <CategorySelect value={category} onChange={setCategory} />
            <Button
              size="icon"
              onClick={add}
              disabled={create.isPending || !name.trim()}
              aria-label="Add status"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ColorSwatches value={color} onChange={setColor} />
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
