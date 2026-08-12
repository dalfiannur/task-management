import { Outlet } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "../api/hooks";
import { ProjectDetailHeader } from "./project-detail-header";
import { ProjectTabNav } from "./project-tab-nav";

/** Detail shell: header + tab nav + <Outlet/> for the active tab.
 *  Non-member GetProject → PERMISSION_DENIED surfaces as an access-denied state. */
export function ProjectShell({ projectId }: { projectId: string }) {
  const { project, isLoading, isError, error } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="p-12 text-center">
        <p className="text-danger">
          {error?.message ?? "You don’t have access to this project."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <ProjectDetailHeader project={project} />
      <ProjectTabNav projectId={projectId} />
      <Outlet />
    </div>
  );
}
