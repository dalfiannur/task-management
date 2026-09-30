import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  ListChecks,
  LogOut,
  MoreHorizontal,
  Search,
  SearchX,
  UserMinus,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiStrip } from "@/components/shared/kpi-strip";
import { cn, getInitials } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useProjectMembers } from "@/features/projects";
import { useTasks } from "@/features/tasks";
import { useUserMap } from "@/features/users";
import { useRemoveMember, useLeaveProject } from "../api/hooks";
import {
  EMPTY_MEMBER_STATS,
  workloadByMember,
  type MemberStats,
} from "../member-stats";
import { AddMemberDialog } from "./add-member-dialog";

// Column widths shared by the header and the rows, so they line up.
const COLS = {
  open: "w-16 shrink-0 text-right",
  overdue: "w-16 shrink-0 text-right",
  progress: "w-40 shrink-0",
  actions: "w-8 shrink-0",
};

interface Row {
  userId: string;
  isOwner: boolean;
  name: string;
  phone?: string;
  avatarUrl?: string;
  stats: MemberStats;
}

export function MembersTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const { members, memberIds, ownerId, isLoading } = useProjectMembers(projectId);
  const { tasks, isLoading: tasksLoading } = useTasks(projectId);
  const userMap = useUserMap();
  const remove = useRemoveMember();
  const leave = useLeaveProject();
  const [q, setQ] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);

  const canManage = isAdmin || ownerId === me?.id;
  const iAmMember = !!me && memberIds.includes(me.id);
  const iAmOwner = ownerId === me?.id;

  const workload = useMemo(() => workloadByMember(tasks), [tasks]);

  // Owner first, then by name.
  const rows: Row[] = useMemo(
    () =>
      members
        .map((m) => {
          const u = userMap[m.userId];
          return {
            userId: m.userId,
            isOwner: m.isOwner,
            name: u?.displayName ?? m.userId,
            phone: u?.phone,
            avatarUrl: u?.avatarUrl,
            stats: workload.byUser[m.userId] ?? EMPTY_MEMBER_STATS,
          };
        })
        .sort((a, b) => {
          if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [members, userMap, workload],
  );

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          (r.phone ?? "").toLowerCase().includes(needle),
      )
    : rows;

  function viewTasks(userId: string) {
    navigate({
      to: "/projects/$projectId/all-tasks",
      params: { projectId },
      search: { assignee: userId },
    });
  }

  function removeMember(row: Row) {
    remove.mutate(
      { projectId, userId: row.userId },
      {
        onSuccess: () => toast.success(`${row.name} removed.`),
        onError: (err) => toast.error(err.message || "Failed to remove"),
      },
    );
  }

  function leaveProject() {
    leave.mutate(
      { projectId },
      {
        onSuccess: () => {
          toast.success("You left the project.");
          navigate({ to: "/projects" });
        },
        onError: (err) => toast.error(err.message || "Failed to leave"),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-[5.5rem] w-full rounded-xl shadow-2" />
        <Skeleton className="h-48 w-full rounded-xl shadow-2" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <Input
            type="search"
            placeholder="Search members…"
            aria-label="Search members"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="!pl-8" /* beats the module's padding shorthand */
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {iAmMember && !iAmOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={leaveProject}
              disabled={leave.isPending}
            >
              <LogOut className="mr-1 h-4 w-4" />
              Leave
            </Button>
          )}
          {canManage && (
            <AddMemberDialog projectId={projectId} memberIds={memberIds} />
          )}
        </div>
      </div>

      <KpiStrip
        cells={[
          { label: "Members", value: members.length },
          {
            label: "Assigned open",
            value: workload.assignedOpen,
            hint: "tasks",
          },
          { label: "Unassigned", value: workload.unassigned, hint: "open" },
          {
            label: "Overdue",
            value: workload.overdue,
            alert: workload.overdue > 0,
          },
        ]}
      />

      <section className="space-y-2">
        <h2 className="text-label">
          Workload{" "}
          <span className="text-num">
            ({visible.length === rows.length
              ? rows.length
              : `${visible.length} / ${rows.length}`})
          </span>
        </h2>

        <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
          <div
            aria-hidden="true"
            className="hidden items-center gap-3 border-b border-border-subtle bg-surface-sunken/40 px-4 py-1.5 text-label md:flex"
          >
            <span className="flex-1">Member</span>
            <span className={COLS.open}>Open</span>
            <span className={COLS.overdue}>Overdue</span>
            <span className={COLS.progress}>Done</span>
            <span className={COLS.actions} />
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-text-muted">
              <SearchX className="h-5 w-5 text-text-subtle" />
              No members match “{q.trim()}”.
            </div>
          ) : (
            <ul>
              {visible.map((r) => (
                <MemberRow
                  key={r.userId}
                  row={r}
                  isMe={r.userId === me?.id}
                  statsLoading={tasksLoading}
                  canRemove={canManage && !r.isOwner}
                  onViewTasks={() => viewTasks(r.userId)}
                  onRemove={() => setConfirmRemove(r)}
                />
              ))}
            </ul>
          )}

          {canManage && rows.length === 1 && !needle && (
            <p className="border-t border-border-subtle px-4 py-3 text-sm text-text-muted">
              No other members yet — add some to assign them tasks.
            </p>
          )}
        </div>
      </section>

      {/* Controlled from the menu item: an AlertDialogTrigger inside the menu
          would unmount with it the moment the menu closes. */}
      <AlertDialog
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this project.
              {confirmRemove && confirmRemove.stats.open > 0 &&
                ` Their ${confirmRemove.stats.open} open task(s) stay assigned to them.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemove && removeMember(confirmRemove)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemberRow({
  row,
  isMe,
  statsLoading,
  canRemove,
  onViewTasks,
  onRemove,
}: {
  row: Row;
  isMe: boolean;
  statsLoading: boolean;
  canRemove: boolean;
  onViewTasks: () => void;
  onRemove: () => void;
}) {
  const { stats } = row;
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <li className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0">
      <Avatar size="lg">
        {row.avatarUrl && <AvatarImage src={row.avatarUrl} />}
        <AvatarFallback>{getInitials(row.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{row.name}</span>
          {isMe && <span className="text-xs text-text-muted">(you)</span>}
          {row.isOwner && <Badge variant="secondary">Owner</Badge>}
        </div>
        {row.phone && (
          <span className="block truncate text-xs text-text-muted">
            {row.phone}
          </span>
        )}
        {/* Below md the columns are hidden; the counts ride under the name. */}
        {!statsLoading && (
          <span className="text-num block text-xs text-text-muted md:hidden">
            {stats.open} open
            {stats.overdue > 0 && (
              <span className="text-danger"> · {stats.overdue} overdue</span>
            )}
            {stats.total > 0 && ` · ${pct}% done`}
          </span>
        )}
      </div>

      {statsLoading ? (
        <Skeleton className="hidden h-4 w-[17rem] md:block" />
      ) : (
        <>
          <span className={cn(COLS.open, "text-num hidden text-sm md:block")}>
            {stats.open}
          </span>
          <span
            className={cn(
              COLS.overdue,
              "text-num hidden text-sm md:block",
              stats.overdue > 0 ? "font-medium text-danger" : "text-text-subtle",
            )}
          >
            {stats.overdue}
          </span>
          <div className={cn(COLS.progress, "hidden items-center gap-2 md:flex")}>
            {stats.total > 0 ? (
              <>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label={`${row.name}: tasks done`}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct === 100 ? "bg-success" : "bg-brand",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-num whitespace-nowrap text-xs text-text-muted">
                  {stats.done}/{stats.total}
                </span>
              </>
            ) : (
              <span className="text-xs text-text-subtle">No tasks</span>
            )}
          </div>
        </>
      )}

      <div className={COLS.actions}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`${row.name} actions`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onViewTasks}>
              <ListChecks className="h-4 w-4" />
              View tasks
            </DropdownMenuItem>
            {canRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <UserMinus className="h-4 w-4" />
                  Remove from project
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
