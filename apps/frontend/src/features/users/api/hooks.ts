// User directory — shared read hooks (pickers, owner/member resolution) plus
// the admin management surface behind /admin/users.

import {
  createConnectQueryKey,
  useMutation,
  useQuery,
} from "@connectrpc/connect-query";
import { useMemo } from "react";
import {
  UserDirectoryService,
  UserStatus as PbUserStatus,
} from "@/lib/gen/users_pb";
import { queryClient } from "@/lib/query";
import { mapUser, type AppUser, type UserStatus } from "@/features/auth";

/**
 * Flat status → proto enum, the inverse of the `mapStatus` used on the way in.
 * `unknown` has no wire form: the server rejects an unrecognised code rather
 * than reading it as "no filter", so asking for it would be a 400 — callers
 * should omit `status` instead.
 */
const STATUS_TO_PROTO: Record<Exclude<UserStatus, "unknown">, PbUserStatus> = {
  pending: PbUserStatus.PENDING,
  active: PbUserStatus.ACTIVE,
  suspended: PbUserStatus.SUSPENDED,
};

/**
 * Invalidate at the service level, not per-method. Approving someone changes
 * what `SearchUsers` returns as well as what `ListUsers` returns — a freshly
 * approved user has to appear in every assignee and member picker without a
 * reload, and those are fed by SearchUsers.
 */
function invalidateUsers() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: UserDirectoryService,
      cardinality: "finite",
    }),
  });
}

/** Active-user directory (matches display_name/phone). Cached; enables pickers. */
export function useUserDirectory(q?: string) {
  const result = useQuery(UserDirectoryService.method.searchUsers, { q }, {
    staleTime: 60_000,
  });
  const users: AppUser[] = useMemo(
    () => result.data?.users.map(mapUser) ?? [],
    [result.data],
  );
  return { ...result, users };
}

/** id → AppUser map over the directory, for resolving owner/member display. */
export function useUserMap(q?: string): Record<string, AppUser> {
  const { users } = useUserDirectory(q);
  return useMemo(() => {
    const map: Record<string, AppUser> = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);
}

/** Server default is 20; named here so the page can size its own requests. */
export const USERS_PAGE_SIZE = 20;

/**
 * One page of users, optionally narrowed to a status. Admin only — the server
 * refuses ListUsers to anyone else.
 *
 * Paging is done server-side, so a caller cannot fetch once and split the
 * result by status in the browser: a pending account may sit on page three.
 * The pending queue and the full list therefore issue separate queries. They
 * stay in agreement because every mutation here invalidates at the service
 * level, which refetches both.
 */
export function useUsersPage({
  status,
  page = 1,
  pageSize = USERS_PAGE_SIZE,
}: {
  status?: Exclude<UserStatus, "unknown">;
  page?: number;
  pageSize?: number;
}) {
  const result = useQuery(UserDirectoryService.method.listUsers, {
    status: status === undefined ? undefined : STATUS_TO_PROTO[status],
    page,
    pageSize,
  });
  const users: AppUser[] = useMemo(
    () => result.data?.users.map(mapUser) ?? [],
    [result.data],
  );
  return { ...result, users, total: result.data?.total ?? 0 };
}

/** Pending or suspended → active. Server notifies the user on approval. */
export function useActivateUser() {
  return useMutation(UserDirectoryService.method.activateUser, {
    onSuccess: invalidateUsers,
  });
}

/** Blocks login and drops the user from pickers; reversible via activate. */
export function useSuspendUser() {
  return useMutation(UserDirectoryService.method.suspendUser, {
    onSuccess: invalidateUsers,
  });
}

export function useSetAdmin() {
  return useMutation(UserDirectoryService.method.setAdmin, {
    onSuccess: invalidateUsers,
  });
}
