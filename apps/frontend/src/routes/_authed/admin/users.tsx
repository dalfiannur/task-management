import { createFileRoute, redirect } from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import { isAdminAtom } from "@/features/auth";
import { ManageUsersPage } from "@/features/users";

/**
 * Admin-only. The guard mirrors `_authed.tsx`: read the atom straight from the
 * default store in `beforeLoad`, outside React. It is a UX guard, not the
 * security boundary — every RPC this page calls is refused server-side by
 * `require_admin`, and that is what actually protects the data.
 */
export const Route = createFileRoute("/_authed/admin/users")({
  beforeLoad: () => {
    if (!getDefaultStore().get(isAdminAtom)) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ManageUsersPage,
});
