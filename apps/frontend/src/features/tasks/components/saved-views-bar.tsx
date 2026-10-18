import { useState } from "react";
import { useAtomValue } from "jotai";
import { Bookmark, MoreHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
} from "sedjiwa-ui";
import { cn } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import type { TasksView } from "../atoms/view";
import { filterToQuery, hasActiveFilter, queryToFilter, type TaskFilter } from "../filter";
import {
  layoutToProto,
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
  type SavedView,
} from "../api/views";

/** Name (+ sharing, on create) for a view, in one small dialog. */
function ViewNameDialog({
  open,
  onOpenChange,
  title,
  initialName,
  withShare,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initialName: string;
  withShare: boolean;
  pending: boolean;
  onSubmit: (name: string, shared: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [shared, setShared] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  // Re-seed each time the dialog opens, not on every render.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(initialName);
      setShared(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim(), shared);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="view-name">Name</Label>
            <Input.Root>
              <Input.Field
                id="view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My urgent bugs"
                maxLength={80}
                autoFocus
              />
            </Input.Root>
          </div>
          {withShare && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="view-shared" className="font-normal">
                Share with everyone in this project
              </Label>
              <Switch id="view-shared" checked={shared} onCheckedChange={setShared} />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Saved views over the Tasks tab: "All tasks", then the caller's own views and
 * the project's shared ones. Picking one applies its filter and layout; the
 * active one is marked modified once the filter or layout drifts from it.
 */
export function SavedViewsBar({
  projectId,
  projectOwnerId,
  filter,
  layout,
  activeId,
  onApply,
  onActivate,
}: {
  projectId: string;
  projectOwnerId?: string;
  filter: TaskFilter;
  layout: TasksView;
  /** The `?view=` the tab was opened with, if any. */
  activeId?: string;
  /** Apply a view (its filter + layout), or clear back to all tasks. */
  onApply: (view: SavedView | null) => void;
  /** Mark a view active without touching the filter (just saved it). */
  onActivate: (id: string | undefined) => void;
}) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { views } = useSavedViews(projectId);
  const create = useCreateSavedView();
  const update = useUpdateSavedView();
  const del = useDeleteSavedView();
  const [dialog, setDialog] = useState<"save" | "rename" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const active = views.find((v) => v.id === activeId);
  const query = filterToQuery(filter);
  const modified =
    !!active &&
    (filterToQuery(queryToFilter(active.query)) !== query || active.layout !== layout);
  const owns = (v: SavedView) => v.ownerId === me?.id || isAdmin;
  const canEdit = (v: SavedView) => owns(v) || (v.shared && projectOwnerId === me?.id);
  const canSave = hasActiveFilter(filter) && (!active || modified);

  // Nothing saved and nothing to save: no bar at all.
  if (views.length === 0 && !canSave) return null;

  const onError = (e: { message: string }) => toast.error(e.message || "Failed to save view");

  function save(name: string, shared: boolean) {
    create.mutate(
      { projectId, name, query, layout: layoutToProto(layout), shared },
      {
        onSuccess: (v) => {
          setDialog(null);
          onActivate(v.id);
          toast.success(`View "${v.name}" saved.`);
        },
        onError,
      },
    );
  }

  function rename(name: string) {
    if (!active) return;
    update.mutate({ id: active.id, name }, { onSuccess: () => setDialog(null), onError });
  }

  function overwrite() {
    if (!active) return;
    update.mutate(
      { id: active.id, query, layout: layoutToProto(layout) },
      { onSuccess: () => toast.success(`View "${active.name}" updated.`), onError },
    );
  }

  function toggleShare() {
    if (!active) return;
    update.mutate({ id: active.id, shared: !active.shared }, { onError });
  }

  function remove() {
    if (!active) return;
    del.mutate(
      { id: active.id },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          onActivate(undefined);
        },
        onError,
      },
    );
  }

  const chip = (selected: boolean) =>
    cn(
      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm",
      "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
      selected
        ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  return (
    <div className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <nav aria-label="Saved views" className="flex items-center gap-1">
        <button
          type="button"
          className={chip(!active)}
          aria-current={!active ? "true" : undefined}
          onClick={() => onApply(null)}
        >
          All tasks
        </button>
        {views.map((v) => {
          const selected = v.id === active?.id;
          return (
            <button
              key={v.id}
              type="button"
              className={chip(selected)}
              aria-current={selected ? "true" : undefined}
              onClick={() => onApply(v)}
              title={v.shared ? "Shared with the project" : "Only you see this view"}
            >
              {v.shared && <Users aria-hidden="true" className="h-3.5 w-3.5" />}
              {v.name}
              {selected && modified && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-warning"
                  aria-label="(modified)"
                />
              )}
            </button>
          );
        })}
      </nav>

      {active && canEdit(active) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={`Options for view ${active.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!modified} onSelect={overwrite}>
              Update with current filters
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename…</DropdownMenuItem>
            {owns(active) && (
              <DropdownMenuItem onSelect={toggleShare}>
                {active.shared ? "Make private" : "Share with project"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {canSave && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-1 shrink-0"
          onClick={() => setDialog("save")}
        >
          <Bookmark className="mr-1 h-4 w-4" />
          {active ? "Save as new view" : "Save view"}
        </Button>
      )}

      <ViewNameDialog
        open={dialog === "save"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Save view"
        initialName=""
        withShare
        pending={create.isPending}
        onSubmit={save}
      />
      <ViewNameDialog
        open={dialog === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rename view"
        initialName={active?.name ?? ""}
        withShare={false}
        pending={update.isPending}
        onSubmit={(name) => rename(name)}
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete view "{active?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {active?.shared
                ? "It disappears for everyone in the project. Tasks are not affected."
                : "Tasks are not affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
