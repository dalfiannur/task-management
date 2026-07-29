import { createFileRoute } from "@tanstack/react-router";
import { MembersTab } from "@/features/members";

export const Route = createFileRoute("/_authed/projects/$projectId/members")({
  component: Members,
});

function Members() {
  const { projectId } = Route.useParams();
  return <MembersTab projectId={projectId} />;
}
