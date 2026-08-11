import { createFileRoute } from "@tanstack/react-router";
import { OverviewTab } from "@/features/overview";

export const Route = createFileRoute("/_authed/projects/$projectId/overview")({
  component: Overview,
});

function Overview() {
  const { projectId } = Route.useParams();
  return <OverviewTab projectId={projectId} />;
}
