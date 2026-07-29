import { createFileRoute } from "@tanstack/react-router";
import { MediaTab } from "@/features/media";

export const Route = createFileRoute("/_authed/projects/$projectId/media")({
  component: Media,
});

function Media() {
  const { projectId } = Route.useParams();
  return <MediaTab projectId={projectId} />;
}
