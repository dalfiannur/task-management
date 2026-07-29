import { createFileRoute } from "@tanstack/react-router";
import { ProjectShell } from "@/features/projects";

export const Route = createFileRoute("/_authed/projects/$projectId")({
  component: DetailShell,
});

function DetailShell() {
  const { projectId } = Route.useParams();
  return <ProjectShell projectId={projectId} />;
}
