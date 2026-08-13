import { createFileRoute } from "@tanstack/react-router";
import { ProjectShell } from "@/features/projects";

// Lives on the layout route (not a tab) so a deep link opens the task dialog
// over whichever tab the user lands on, and every tab child inherits these
// params without redeclaring them.
export const Route = createFileRoute("/_authed/projects/$projectId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { task?: string; comment?: string } => ({
    task: typeof search.task === "string" ? search.task : undefined,
    comment: typeof search.comment === "string" ? search.comment : undefined,
  }),
  component: DetailShell,
});

function DetailShell() {
  const { projectId } = Route.useParams();
  return <ProjectShell projectId={projectId} />;
}
