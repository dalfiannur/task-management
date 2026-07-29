import { createFileRoute } from "@tanstack/react-router";
import { RecentActivity } from "@/features/activity";

/** Interim dashboard: recent activity feed. The dashboard flow adds stat cards
 *  and my-tasks around this. */
export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section className="max-w-2xl">
        <h2 className="mb-3 text-lg font-medium">Recent activity</h2>
        <RecentActivity />
      </section>
    </div>
  );
}
