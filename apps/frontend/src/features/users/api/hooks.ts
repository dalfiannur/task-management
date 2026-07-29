// User directory — shared read hooks (pickers, owner/member resolution).

import { useQuery } from "@connectrpc/connect-query";
import { useMemo } from "react";
import { UserDirectoryService } from "@/lib/gen/users_pb";
import { mapUser, type AppUser } from "@/features/auth";

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
