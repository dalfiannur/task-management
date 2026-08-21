import { useState } from "react";
import { useAtomValue } from "jotai";
import { ShieldCheck, ShieldOff, UserCheck, UserRoundCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { getInitials } from "@/lib/utils";
import { currentUserAtom, type AppUser, type UserStatus } from "@/features/auth";
import {
  useUsersPage,
  useActivateUser,
  useSetAdmin,
  useSuspendUser,
  USERS_PAGE_SIZE,
} from "../api/hooks";
import { Pagination } from "./pagination";

/**
 * The pending queue is a worklist, not an archive: it normally holds zero to a
 * handful of rows, and page controls on that would be noise. It asks for the
 * server maximum in one go and says so when more are waiting.
 */
const PENDING_PAGE_SIZE = 50;

const STATUS_LABEL: Record<UserStatus, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
  unknown: "Unknown",
};

/** `secondary` reads as neutral information; `destructive` marks a blocked
 *  account. Pending deliberately gets `outline` rather than a loud colour —
 *  the queue heading above already carries the urgency. */
const STATUS_VARIANT: Record<UserStatus, "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  active: "secondary",
  suspended: "destructive",
  unknown: "outline",
};

/**
 * One user, with the actions its current status allows.
 *
 * Actions are derived from `status` rather than from which list the row sits
 * in, so the pending queue and the full list can render the same component
 * with no variant flag: a suspended user offers "Activate" wherever it appears.
 *
 * `isSelf` strips every action. Suspending yourself or dropping your own admin
 * mark takes away the permission needed to undo it, and with one admin that
 * locks the instance out of user management. The server refuses these too
 * (deny_self in directory_service.rs) — this only keeps the button from being
 * offered in the first place.
 */
function UserRow({
  user,
  isSelf,
  onActivate,
  onSuspend,
  onSetAdmin,
  busy,
}: {
  user: AppUser;
  isSelf: boolean;
  onActivate: (u: AppUser) => void;
  onSuspend: (u: AppUser) => void;
  onSetAdmin: (u: AppUser, isAdmin: boolean) => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar size="sm">
        {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
        <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {user.displayName}
          {isSelf && <span className="ml-2 text-xs text-text-muted">you</span>}
        </p>
        <p className="text-num truncate text-xs text-text-muted">{user.phone}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {user.isAdmin && <Badge variant="secondary">Admin</Badge>}
        <Badge variant={STATUS_VARIANT[user.status]}>
          {STATUS_LABEL[user.status]}
        </Badge>
      </div>
      {!isSelf && (
        <div className="flex shrink-0 items-center gap-1">
          {user.status !== "active" && (
            <Button size="sm" onClick={() => onActivate(user)} disabled={busy}>
              <UserCheck className="mr-1 h-4 w-4" />
              {user.status === "pending" ? "Approve" : "Activate"}
            </Button>
          )}
          {user.status !== "suspended" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSuspend(user)}
              disabled={busy}
            >
              <UserX className="mr-1 h-4 w-4" />
              {user.status === "pending" ? "Reject" : "Suspend"}
            </Button>
          )}
          {user.status === "active" && (
            // Confirmed, unlike the other two: granting admin hands over every
            // project and every account, and the person who receives it is the
            // only one who cannot take it back from themselves.
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={busy}>
                  {user.isAdmin ? (
                    <ShieldOff className="mr-1 h-4 w-4" />
                  ) : (
                    <ShieldCheck className="mr-1 h-4 w-4" />
                  )}
                  {user.isAdmin ? "Revoke admin" : "Make admin"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {user.isAdmin
                      ? `Revoke admin from ${user.displayName}?`
                      : `Make ${user.displayName} an admin?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {user.isAdmin
                      ? "They keep their account but lose access to every project and to user management."
                      : "Admins can see and change every project, approve accounts, and grant admin to others."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onSetAdmin(user, !user.isAdmin)}
                  >
                    {user.isAdmin ? "Revoke" : "Make admin"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </li>
  );
}

function UserList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y divide-border-subtle rounded-xl bg-surface-raised shadow-2">
      {children}
    </ul>
  );
}

/** Admin-only user management: approve registrations, suspend, grant admin. */
export function ManageUsersPage() {
  const me = useAtomValue(currentUserAtom);
  const [page, setPage] = useState(1);
  // Two queries, not one filtered client-side: with server paging a pending
  // account can sit on any page of the full list, so it cannot be found by
  // partitioning a single page. Service-level invalidation keeps them agreeing.
  const pendingQuery = useUsersPage({
    status: "pending",
    pageSize: PENDING_PAGE_SIZE,
  });
  const allQuery = useUsersPage({ page });
  const isLoading = pendingQuery.isLoading || allQuery.isLoading;
  const activate = useActivateUser();
  const suspend = useSuspendUser();
  const setAdmin = useSetAdmin();
  const busy = activate.isPending || suspend.isPending || setAdmin.isPending;

  const pending = pendingQuery.users;
  const pendingShown = pending.length;
  const pendingMore = Math.max(0, pendingQuery.total - pendingShown);

  function onActivate(u: AppUser) {
    activate.mutate(
      { id: u.id },
      {
        onSuccess: () => toast.success(`${u.displayName} is now active.`),
        onError: (e) => toast.error(e.message || "Failed to activate user"),
      },
    );
  }

  function onSuspend(u: AppUser) {
    suspend.mutate(
      { id: u.id },
      {
        onSuccess: () => toast.success(`${u.displayName} was suspended.`),
        onError: (e) => toast.error(e.message || "Failed to suspend user"),
      },
    );
  }

  function onSetAdmin(u: AppUser, isAdmin: boolean) {
    setAdmin.mutate(
      { id: u.id, isAdmin },
      {
        onSuccess: () =>
          toast.success(
            isAdmin
              ? `${u.displayName} is now an admin.`
              : `${u.displayName} is no longer an admin.`,
          ),
        onError: (e) => toast.error(e.message || "Failed to change admin"),
      },
    );
  }

  const rowProps = { onActivate, onSuspend, onSetAdmin, busy };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6" aria-busy="true" aria-label="Loading users">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-xl shadow-2" />
        <Skeleton className="h-64 w-full rounded-xl shadow-2" />
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <h1 className="text-2xl font-bold">Manage users</h1>

      <section className="space-y-2">
        <h2 className="text-label">
          Pending approval
          {pendingQuery.total > 0 && (
            <span className="text-num ml-1 text-text-muted">
              {pendingQuery.total}
            </span>
          )}
        </h2>
        {pending.length === 0 ? (
          // "cleared", not "first-run": an empty queue is the good state, so it
          // gets a reassuring line and deliberately no call to action — there
          // is nothing here for the admin to do.
          <EmptyState
            variant="cleared"
            size="compact"
            icon={UserRoundCheck}
            title="No one is waiting"
            body="New registrations land here until you approve them."
          />
        ) : (
          <>
            <UserList>
              {pending.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={u.id === me?.id}
                  {...rowProps}
                />
              ))}
            </UserList>
            {pendingMore > 0 && (
              // No page control here on purpose; the queue drains as you work
              // it, so the rest surface on their own once these are handled.
              <p className="text-xs text-text-muted">
                <span className="text-num">{pendingMore}</span> more waiting —
                approve or reject these first.
              </p>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-label">
          All users
          <span className="text-num ml-1 text-text-muted">
            {allQuery.total}
          </span>
        </h2>
        <UserList>
          {allQuery.users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === me?.id}
              {...rowProps}
            />
          ))}
        </UserList>
        <Pagination
          page={page}
          pageSize={USERS_PAGE_SIZE}
          total={allQuery.total}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}
