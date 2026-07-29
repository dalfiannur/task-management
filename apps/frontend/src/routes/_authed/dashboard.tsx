import { createFileRoute } from "@tanstack/react-router";
import { StatCards, UpcomingDeadlines } from "@/features/dashboard";
import { RecentActivity } from "@/features/activity";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <StatCards />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-medium">Upcoming deadlines</h2>
          <UpcomingDeadlines withinDays={7} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-medium">Recent activity</h2>
          <RecentActivity />
        </section>
      </div>
    </div>
  );
}
