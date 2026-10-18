import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { format } from "date-fns";
import { ChevronDown, MoreHorizontal, Plus, Zap } from "lucide-react";
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
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Switch,
} from "sedjiwa-ui";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useProject } from "@/features/projects";
import {
  useAutomationRuns,
  useAutomations,
  useDeleteAutomation,
  useSetAutomationEnabled,
} from "../api/hooks";
import { describeRule, lastRunLabel, presets } from "../describe";
import type { Automation, AutomationDraft, AutomationRun } from "../types";
import { AutomationDialog } from "./automation-dialog";
import { useVocab } from "./use-vocab";

const BLANK: AutomationDraft = {
  name: "",
  trigger: { kind: "status_changed" },
  conditions: { priorities: [], labelIds: [], moduleIds: [] },
  actions: [{ kind: "set_priority", priority: "high" }],
};

const RUN_TONE: Record<AutomationRun["status"], string> = {
  ok: "text-success-subtle-text",
  failed: "text-destructive",
  skipped: "text-warning-subtle-text",
};

/** A project's automation rules and their recent runs. Owners and admins
 *  edit; members read. */
export function AutomationsTab({ projectId }: { projectId: string }) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { project } = useProject(projectId);
  const canEdit = isAdmin || (!!project && project.ownerId === me?.id);
  const vocab = useVocab(projectId);
  const { automations, isLoading } = useAutomations(projectId);
  const { runs } = useAutomationRuns(projectId);
  const toggle = useSetAutomationEnabled();
  const del = useDeleteAutomation();
  const [dialog, setDialog] = useState<{ open: boolean; id?: string; draft: AutomationDraft }>({
    open: false,
    draft: BLANK,
  });
  const [confirm, setConfirm] = useState<Automation | null>(null);

  const starters = useMemo(() => {
    const byName = (name: string) => vocab.statuses.find((s) => s.name.toLowerCase() === name)?.id;
    return presets({
      doneStatusId: byName("done"),
      reviewStatusId: byName("review"),
      lateLabelId: vocab.labels.find((l) => /late|overdue/i.test(l.name))?.id,
    });
  }, [vocab.statuses, vocab.labels]);

  function openNew(draft: AutomationDraft) {
    setDialog({ open: true, draft });
  }
  function openEdit(a: Automation) {
    setDialog({
      open: true,
      id: a.id,
      draft: { name: a.name, trigger: a.trigger ?? BLANK.trigger, conditions: a.conditions, actions: a.actions },
    });
  }

  const newButton = canEdit && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New automation
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuItem onSelect={() => openNew(BLANK)}>Start from scratch</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Start from a preset</DropdownMenuLabel>
        {starters.map((p) => (
          <DropdownMenuItem key={p.key} onSelect={() => openNew(p.draft)}>
            {p.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Automations</h2>
          <p className="text-sm text-muted-foreground">
            Rules that act on tasks for you: when something happens, if it matches, then do this.
            {!canEdit && " Only the project owner or an admin can change them."}
          </p>
        </div>
        {newButton}
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl shadow-sm" />
      ) : automations.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Automations take the routine off your hands"
          body="Clear assignees when work is done, flag overdue tasks, or move a parent on once its subtasks are finished."
          actionSlot={newButton || undefined}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-sm">
          {automations.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <Switch
                className="mt-0.5"
                checked={a.enabled}
                disabled={!canEdit || toggle.isPending}
                aria-label={`${a.enabled ? "Pause" : "Turn on"} ${a.name}`}
                onCheckedChange={(on) =>
                  toggle.mutate(
                    { id: a.id, enabled: on },
                    { onError: (e) => toast.error(e.message || "Failed to update") },
                  )
                }
              />
              <div className={cn("min-w-0 flex-1", !a.enabled && "opacity-60")}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{a.name}</span>
                  {!a.enabled && <Badge variant="secondary">Paused</Badge>}
                  {!a.trigger && <Badge variant="destructive">Broken</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{describeRule(a, vocab.names)}</p>
                <p className="text-num text-xs text-muted-foreground">
                  {a.runCount} run{a.runCount === 1 ? "" : "s"} · {lastRunLabel(a.lastRunAt)}
                </p>
              </div>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`${a.name} actions`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openEdit(a)}>Edit…</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(a)}>
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        <h3 className="text-label">Recent runs</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card text-sm shadow-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2">
                <span className={cn("w-14 shrink-0 text-xs font-medium uppercase", RUN_TONE[r.status])}>
                  {r.status}
                </span>
                <span className="shrink-0 font-medium">{r.automationName || "(deleted rule)"}</span>
                {r.taskTitle ? (
                  <Link
                    to="/projects/$projectId/all-tasks"
                    params={{ projectId }}
                    search={{ task: r.taskId }}
                    className="min-w-0 truncate hover:underline"
                  >
                    <span className="text-num text-muted-foreground">#{r.taskNumber}</span> {r.taskTitle}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">(deleted task)</span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.detail}</span>
                <span className="text-num shrink-0 text-xs text-muted-foreground">
                  {format(new Date(r.createdAt), "MMM d, HH:mm")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AutomationDialog
        projectId={projectId}
        vocab={vocab}
        editingId={dialog.id}
        initial={dialog.draft}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirm?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its run history goes with it. Tasks it already changed stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm &&
                del.mutate(
                  { id: confirm.id },
                  {
                    onSuccess: () => setConfirm(null),
                    onError: (e) => toast.error(e.message || "Delete failed"),
                  },
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
