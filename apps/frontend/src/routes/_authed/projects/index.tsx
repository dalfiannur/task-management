import { createFileRoute } from "@tanstack/react-router";
import { ProjectList } from "@/features/projects";

export const Route = createFileRoute("/_authed/projects/")({
  component: ProjectList,
});
