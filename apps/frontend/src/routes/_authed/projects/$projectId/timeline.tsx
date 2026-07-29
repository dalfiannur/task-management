import { createFileRoute } from "@tanstack/react-router";
import { GanttChart } from "@/features/timeline";

export const Route = createFileRoute("/_authed/projects/$projectId/timeline")({
  component: Timeline,
});

function Timeline() {
  const { projectId } = Route.useParams();
  return <GanttChart projectId={projectId} />;
}
