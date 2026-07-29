import { createFileRoute, redirect } from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import { tokenAtom } from "@/features/auth";
import { AppShell } from "@/features/auth/components/app-shell";

/** Pathless layout: gates all child routes on a token, renders the app shell. */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => {
    const token = getDefaultStore().get(tokenAtom);
    if (!token) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AppShell,
});
