import { Link, useParams } from "react-router";
import { useProject } from "@/hooks/use-projects";
import { GanttChart } from "@/components/timeline/gantt-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import styles from "./timeline.module.css";

export function Component() {
  const { projectId } = useParams();
  const { data: project, isLoading } = useProject(projectId!);

  if (isLoading) {
    return (
      <div className={styles.skeletonPage}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.notFound}>
        Project not found
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Button size="sm" variant="ghost" asChild>
          <Link to={`/projects/${projectId}`}>
            <ArrowLeft className={styles.backIcon} />
            Back
          </Link>
        </Button>
        <h1 className={styles.title}>
          {project.coreDetail?.name.name ?? "Project"} — Timeline
        </h1>
      </div>
      <GanttChart projectId={projectId!} />
    </div>
  );
}
