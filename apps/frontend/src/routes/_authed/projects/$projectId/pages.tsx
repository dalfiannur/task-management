import { createFileRoute } from "@tanstack/react-router";
import { PagesTab } from "@/features/pages";
import { coerceSearchParam } from "@/lib/utils";

export const Route = createFileRoute("/_authed/projects/$projectId/pages")({
  validateSearch: (search: Record<string, unknown>): { page?: string } => ({
    page: coerceSearchParam(search.page),
  }),
  component: Pages,
});

function Pages() {
  const { projectId } = Route.useParams();
  const { page } = Route.useSearch();
  return <PagesTab projectId={projectId} selectedId={page} />;
}
