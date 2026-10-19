import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Eraser, RotateCcw, Trash2 } from "lucide-react";
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
  buttonVariants,
  Input,
  Label,
  Skeleton,
} from "sedjiwa-ui";
import { EmptyState } from "@/components/shared/empty-state";
import { formatMinutes } from "@/lib/duration";
import { useUserMap } from "@/features/users";
import {
  useDeletedProjects,
  usePurgeLeftovers,
  usePurgeProject,
  useRestoreProject,
  type DeletedProject,
  type ProjectContents,
} from "../api/hooks";

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "48 tasks · 120h logged · 15 files (230 MB) · 3 pages", zeros left out. */
function describeContents(c: ProjectContents): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (c.tasks) parts.push(n(c.tasks, "task"));
  if (c.timeMinutes) parts.push(`${formatMinutes(c.timeMinutes)} logged`);
  if (c.mediaFiles) parts.push(`${n(c.mediaFiles, "file")} (${bytes(c.mediaBytes)})`);
  if (c.pages) parts.push(n(c.pages, "page"));
  if (c.comments) parts.push(n(c.comments, "comment"));
  if (c.modules) parts.push(n(c.modules, "module"));
  if (c.automations) parts.push(n(c.automations, "automation"));
  return parts.length ? parts.join(" · ") : "Empty";
}

/** Purge only after typing the project's name: it cannot be undone. */
function PurgeDialog({
  project,
  onOpenChange,
}: {
  project: DeletedProject | null;
  onOpenChange: (open: boolean) => void;
}) {
  const purge = usePurgeProject();
  const [typed, setTyped] = useState("");
  const [last, setLast] = useState(project);
  if (last !== project) {
    setLast(project);
    setTyped("");
  }
  const ok = !!project && typed.trim() === project.name.trim();
  return (
    <AlertDialog open={!!project} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{project?.name}” for good?</AlertDialogTitle>
          <AlertDialogDescription>
            Removed permanently, with its activity, labels, statuses and views. This
            cannot be undone.
          </AlertDialogDescription>
          {project && (
            <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-text">
              {describeContents(project.contents)}
            </p>
          )}
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="purge-confirm">Type the project name to confirm</Label>
          <Input.Root>
            <Input.Field
              id="purge-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </Input.Root>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!ok || purge.isPending}
            onClick={() =>
              project &&
              purge.mutate(
                { id: project.id, confirmName: typed },
                {
                  onSuccess: () => {
                    toast.success(`“${project.name}” deleted for good.`);
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error(e.message || "Delete failed"),
                },
              )
            }
          >
            {purge.isPending ? "Deleting…" : "Delete for good"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Admin: projects in the trash. Restore brings one back exactly as it was;
 * delete removes it and everything in it for good. Nothing is ever removed
 * automatically.
 */
export function TrashPage() {
  const { projects, leftoverCount, leftoverContents, isLoading, isError, error } = useDeletedProjects();
  const restore = useRestoreProject();
  const leftovers = usePurgeLeftovers();
  const userMap = useUserMap();
  const [purging, setPurging] = useState<DeletedProject | null>(null);
  const [confirmLeftovers, setConfirmLeftovers] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Trash</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleted projects are hidden from everyone but kept here until you restore them
          or delete them for good. Nothing is deleted automatically.
        </p>
      </header>

      {isError ? (
        <p className="text-sm text-destructive">{error?.message ?? "Failed to load the trash."}</p>
      ) : isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl shadow-sm" />
      ) : projects.length === 0 ? (
        <EmptyState
          variant="cleared"
          icon={Trash2}
          title="The trash is empty"
          body="Projects someone deletes land here first, so an admin can bring them back."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-sm">
          {projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-num text-xs text-foreground/80">{describeContents(p.contents)}</p>
                <p className="text-xs text-muted-foreground">
                  Deleted {formatDistanceToNowStrict(new Date(p.deletedAt), { addSuffix: true })} by{" "}
                  {userMap[p.deletedBy]?.displayName ?? "someone"} · owner{" "}
                  {userMap[p.ownerId]?.displayName ?? "unknown"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(
                    { id: p.id },
                    {
                      onSuccess: () => toast.success(`“${p.name}” restored.`),
                      onError: (e) => toast.error(e.message || "Restore failed"),
                    },
                  )
                }
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                Restore
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPurging(p)}>
                <Trash2 className="mr-1 h-4 w-4" />
                Delete for good
              </Button>
            </li>
          ))}
        </ul>
      )}

      {leftoverCount > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Leftovers from earlier deletes</p>
            <p className="text-sm text-muted-foreground">
              {leftoverCount} deleted project{leftoverCount === 1 ? "" : "s"} left modules,
              tasks or other data behind (deleted before the trash existed). It is not shown
              anywhere but still takes space.
            </p>
            <p className="text-num mt-1 text-xs text-foreground/80">{describeContents(leftoverContents)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setConfirmLeftovers(true)}>
            <Eraser className="mr-1 h-4 w-4" />
            Clean up
          </Button>
        </section>
      )}

      <PurgeDialog project={purging} onOpenChange={(o) => !o && setPurging(null)} />
      <AlertDialog open={confirmLeftovers} onOpenChange={setConfirmLeftovers}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all leftovers for good?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything left behind by {leftoverCount} already-deleted project
              {leftoverCount === 1 ? "" : "s"} is removed permanently, files included. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-text">
            {describeContents(leftoverContents)}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() =>
                leftovers.mutate(
                  { confirmProjects: leftoverCount },
                  {
                    onSuccess: (r) =>
                      toast.success(
                        `Cleaned up ${r.projects} ${r.projects === 1 ? "project's" : "projects'"} leftovers.`,
                      ),
                    onError: (e) => toast.error(e.message || "Clean-up failed"),
                  },
                )
              }
            >
              Remove for good
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
