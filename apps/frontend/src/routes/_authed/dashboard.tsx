import { createFileRoute, Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { format } from "date-fns";
import {
  KpiStrip,
  NeedsAttention,
  ProjectProgressList,
} from "@/features/dashboard";
import { RecentActivity } from "@/features/activity";
import { currentUserAtom } from "@/features/auth";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardPage() {
  const user = useAtomValue(currentUserAtom);
  const now = new Date();
  const firstName = user?.displayName.split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {greeting(now.getHours())}
          {firstName && `, ${firstName}`}
        </h1>
        <p className="text-num mt-1 text-sm text-text-muted">
          {format(now, "EEEE, d MMMM yyyy")}
        </p>
      </header>

      <KpiStrip />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-label">Needs attention</h2>
            <Link
              to="/my-tasks"
              className="text-xs text-text-muted hover:text-text"
            >
              All my tasks →
            </Link>
          </div>
          <NeedsAttention withinDays={7} />
        </section>

        <aside className="space-y-6">
          <section>
            <h2 className="text-label mb-3">Projects</h2>
            <ProjectProgressList limit={5} />
          </section>
          <section>
            <h2 className="text-label mb-3">Recent activity</h2>
            <RecentActivity pageSize={8} />
          </section>
        </aside>
      </div>
    </div>
  );
}
