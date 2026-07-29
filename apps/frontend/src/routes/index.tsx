import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/` → dashboard (the guard on `_authed` bounces to /login if unauthenticated). */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
