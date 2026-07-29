import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "@/features/auth";

/** Placeholder dashboard — proves the authed shell + `me` RPC end-to-end.
 *  Replaced by the real stat cards in the dashboard flow. */
export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isLoading } = useMe();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        {isLoading
          ? "Loading…"
          : user
            ? `Signed in as ${user.displayName} (${user.phone})`
            : "No session."}
      </p>
    </div>
  );
}
