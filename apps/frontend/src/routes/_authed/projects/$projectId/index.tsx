import { createFileRoute, redirect } from "@tanstack/react-router";

/** Default tab → overview. */
export const Route = createFileRoute("/_authed/projects/$projectId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectId/overview",
      params: { projectId: params.projectId },
    });
  },
});
