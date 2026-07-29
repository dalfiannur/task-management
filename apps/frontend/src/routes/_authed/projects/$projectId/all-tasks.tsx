import { createFileRoute } from "@tanstack/react-router";
import { AllTasksTab } from "@/features/tasks";

export const Route = createFileRoute("/_authed/projects/$projectId/all-tasks")({
  component: AllTasks,
});

function AllTasks() {
  const { projectId } = Route.useParams();
  return <AllTasksTab projectId={projectId} />;
}
