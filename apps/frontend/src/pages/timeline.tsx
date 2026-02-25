import { useParams } from "react-router";
import { GanttChart } from "@/components/timeline/gantt-chart";
import styles from "./timeline.module.css";

export function Component() {
  const { projectId } = useParams();

  if (!projectId) {
    return (
      <div className={styles.notFound}>
        Project not found
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <GanttChart projectId={projectId} />
    </div>
  );
}
