import { createFileRoute, redirect } from "@tanstack/react-router";

/** Default tab → all-tasks. */
export const Route = createFileRoute("/_authed/projects/$projectId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectId/all-tasks",
      params: { projectId: params.projectId },
    });
  },
});
