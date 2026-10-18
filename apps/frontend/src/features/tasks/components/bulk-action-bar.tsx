import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "sedjiwa-ui";
import type { TaskPriority as PbPriority } from "@/lib/gen/work_pb";
import type { AppUser } from "@/features/auth";
import type { Label } from "@/features/labels";
import { TASK_PRIORITIES, type Module, type WorkflowStatus } from "../types";
import { TASK_PRIORITY_CONFIG } from "../config";
import { priorityToProto } from "../api/mappers";
import { useBulkDeleteTasks, useBulkUpdateTasks } from "../api/hooks";
import { StatusDot } from "./task-badges";

/** Which tasks are picked in the list's select mode. */
export interface TaskSelection {
  has: (id: string) => boolean;
  /** Pick (`on`) or drop every id in `ids`. */
  set: (ids: string[], on: boolean) => void;
}

/** One bulk change — the BulkUpdateTasks fields besides the ids. */
interface BulkEdit {
  statusId?: string;
  priority?: PbPriority;
  addAssigneeIds?: string[];
  removeAssigneeIds?: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
  /** "" clears. */
  dueDate?: string;
  moduleId?: string;
}

function Menu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          {label}
          <ChevronDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top" className="max-h-80 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The action bar of the list's select mode: every action applies to all the
 * picked tasks in one BulkUpdateTasks / BulkDeleteTasks call.
 */
export function BulkActionBar({
  projectId,
  selectedIds,
  statuses,
  modules,
  memberIds,
  userMap,
  labelMap,
  onClear,
}: {
  projectId: string;
  selectedIds: string[];
  statuses: WorkflowStatus[];
  modules: Module[];
  memberIds: string[];
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  /** Drop the selection (after a delete, or the ✕). */
  onClear: () => void;
}) {
  const update = useBulkUpdateTasks(projectId);
  const del = useBulkDeleteTasks();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = update.isPending || del.isPending;
  const count = selectedIds.length;
  const labels = Object.values(labelMap).filter((l) => l.projectId === projectId);
  const name = (id: string) => userMap[id]?.displayName ?? "Unknown";

  function apply(edit: BulkEdit) {
    update.mutate({ taskIds: selectedIds, ...edit });
  }

  function remove() {
    del.mutate(
      { taskIds: selectedIds },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          onClear();
        },
      },
    );
  }

  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-fit items-center gap-1 overflow-x-auto rounded-xl border border-border bg-popover px-3 py-2 shadow-lg"
    >
      <span className="text-num mr-2 shrink-0 whitespace-nowrap text-sm font-medium" aria-live="polite">
        {count} selected
      </span>

      <Menu label="Status" disabled={busy}>
        {statuses.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => apply({ statusId: s.id })}>
            <StatusDot status={s.category} color={s.color} className="mr-1.5 h-2 w-2" />
            {s.name}
          </DropdownMenuItem>
        ))}
      </Menu>

      <Menu label="Priority" disabled={busy}>
        {TASK_PRIORITIES.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => apply({ priority: priorityToProto(p) })}>
            {TASK_PRIORITY_CONFIG[p].label}
          </DropdownMenuItem>
        ))}
      </Menu>

      <Menu label="Assignee" disabled={busy}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Add</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {memberIds.map((id) => (
              <DropdownMenuItem key={id} onSelect={() => apply({ addAssigneeIds: [id] })}>
                {name(id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Remove</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {memberIds.map((id) => (
              <DropdownMenuItem key={id} onSelect={() => apply({ removeAssigneeIds: [id] })}>
                {name(id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </Menu>

      <Menu label="Labels" disabled={busy || labels.length === 0}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Add</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {labels.map((l) => (
              <DropdownMenuItem key={l.id} onSelect={() => apply({ addLabelIds: [l.id] })}>
                <span
                  aria-hidden="true"
                  className="mr-1.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Remove</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {labels.map((l) => (
              <DropdownMenuItem key={l.id} onSelect={() => apply({ removeLabelIds: [l.id] })}>
                <span
                  aria-hidden="true"
                  className="mr-1.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </Menu>

      {/* The picker fills its container; a fixed width keeps it one control
          among the others instead of a full row. */}
      <div className="w-36 shrink-0">
        <DatePicker
          size="sm"
          value={null}
          onValueChange={(iso) => iso && apply({ dueDate: iso })}
          placeholder="Set due date"
          locale="en-US"
          formatLabel={(d) => format(d, "MMM d, yyyy")}
        />
      </div>

      <Menu label="More" disabled={busy}>
        <DropdownMenuItem onSelect={() => apply({ dueDate: "" })}>Clear due date</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move to module</DropdownMenuLabel>
        {modules.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => apply({ moduleId: m.id })}>
            {m.name}
          </DropdownMenuItem>
        ))}
      </Menu>

      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        disabled={busy}
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 aria-hidden="true" className="mr-1 h-4 w-4" />
        Delete
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="ml-1 h-8 w-8"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X className="h-4 w-4" />
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} task{count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their subtasks, comments and attachment links go with them. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={del.isPending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
