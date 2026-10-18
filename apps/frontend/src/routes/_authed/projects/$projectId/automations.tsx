import { createFileRoute } from "@tanstack/react-router";
import { AutomationsTab } from "@/features/automations";

export const Route = createFileRoute("/_authed/projects/$projectId/automations")({
  component: Automations,
});

function Automations() {
  const { projectId } = Route.useParams();
  return <AutomationsTab projectId={projectId} />;
}
