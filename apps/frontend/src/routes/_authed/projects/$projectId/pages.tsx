import { createFileRoute } from "@tanstack/react-router";
import { TabPlaceholder } from "@/features/projects";

export const Route = createFileRoute("/_authed/projects/$projectId/pages")({
  component: () => <TabPlaceholder title="Pages" />,
});
