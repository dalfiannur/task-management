import { createFileRoute, redirect } from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import { isAdminAtom } from "@/features/auth";
import { TrashPage } from "@/features/trash";

/** Admin-only (a UX guard; every RPC on the page is admin-checked server-side). */
export const Route = createFileRoute("/_authed/admin/trash")({
  beforeLoad: () => {
    if (!getDefaultStore().get(isAdminAtom)) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: TrashPage,
});
