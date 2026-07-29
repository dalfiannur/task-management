import { createFileRoute } from "@tanstack/react-router";
import { MyTasksView } from "@/features/dashboard";

export const Route = createFileRoute("/_authed/my-tasks")({
  component: MyTasksView,
});
