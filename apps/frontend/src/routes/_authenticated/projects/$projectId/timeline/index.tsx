import { createFileRoute, Link } from "@tanstack/react-router";
import { useProject } from "@/hooks/use-projects";
import { GanttChart } from "@/components/timeline/gantt-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/timeline/",
)({
  component: TimelinePage,
});

function TimelinePage() {
  const { projectId } = Route.useParams();
  const { data: project, isLoading } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Project not found
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-hidden min-w-0">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/projects/$projectId" params={{ projectId }}>
            <ArrowLeft className="size-4 mr-1" />
            Back
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{project.coreDetail?.name.name ?? "Project"} — Timeline</h1>
      </div>
      <GanttChart projectId={projectId} />
    </div>
  );
}
