import { createFileRoute } from "@tanstack/react-router";
import { ProjectShell } from "@/features/projects";
import { parseTaskFilter, type TaskFilter } from "@/features/tasks";
import { coerceSearchParam } from "@/lib/utils";

// Lives on the layout route (not a tab) so a deep link opens the task dialog
// over whichever tab the user lands on, and every tab child inherits these
// params without redeclaring them. The Tasks-tab filter rides along here for
// the same reason it is in the URL at all: a filtered view is shareable, and
// Back/forward walks the filter history.
export const Route = createFileRoute("/_authed/projects/$projectId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { task?: string; comment?: string } & TaskFilter => ({
    task: coerceSearchParam(search.task),
    comment: coerceSearchParam(search.comment),
    ...parseTaskFilter(search),
  }),
  component: DetailShell,
});

function DetailShell() {
  const { projectId } = Route.useParams();
  return <ProjectShell projectId={projectId} />;
}
