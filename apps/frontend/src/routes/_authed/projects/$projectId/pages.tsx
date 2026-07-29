import { createFileRoute } from "@tanstack/react-router";
import { PagesTab } from "@/features/pages";

export const Route = createFileRoute("/_authed/projects/$projectId/pages")({
  component: Pages,
});

function Pages() {
  const { projectId } = Route.useParams();
  return <PagesTab projectId={projectId} />;
}
