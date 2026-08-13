import { createFileRoute } from "@tanstack/react-router";
import { PagesTab } from "@/features/pages";

export const Route = createFileRoute("/_authed/projects/$projectId/pages")({
  validateSearch: (search: Record<string, unknown>): { page?: string } => ({
    page: typeof search.page === "string" ? search.page : undefined,
  }),
  component: Pages,
});

function Pages() {
  const { projectId } = Route.useParams();
  const { page } = Route.useSearch();
  return <PagesTab projectId={projectId} selectedId={page} />;
}
