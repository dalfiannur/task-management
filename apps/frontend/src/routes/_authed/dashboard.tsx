import { createFileRoute } from "@tanstack/react-router";
import { StatCards, UpcomingDeadlines } from "@/features/dashboard";
import { RecentActivity } from "@/features/activity";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <StatCards />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-label mb-3">Upcoming deadlines</h2>
          <UpcomingDeadlines withinDays={7} />
        </section>
        <section>
          <h2 className="text-label mb-3">Recent activity</h2>
          <RecentActivity />
        </section>
      </div>
    </div>
  );
}
