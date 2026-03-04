import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/types/task";
import type { CoreProject } from "@/types/project";
import type { ModuleWithProject } from "@/hooks/use-modules";
import { BarChart3 } from "lucide-react";
import styles from "./project-progress.module.css";

interface ProjectProgressProps {
  projects: CoreProject[];
  tasks: Task[];
  modules: ModuleWithProject[];
}

interface ProjectStat {
  project: CoreProject;
  done: number;
  total: number;
  percentage: number;
}

export function ProjectProgress({ projects, tasks, modules }: ProjectProgressProps) {
  // Build moduleId → projectId map
  const moduleToProject = new Map<string, string>();
  for (const mod of modules) {
    moduleToProject.set(mod.id, mod.projectId);
  }

  // Group tasks by project, exclude cancelled
  const projectTaskCounts = new Map<string, { done: number; total: number }>();
  for (const task of tasks) {
    if (task.status === "cancelled") continue;
    const projectId = moduleToProject.get(task.moduleId);
    if (!projectId) continue;
    const counts = projectTaskCounts.get(projectId) ?? { done: 0, total: 0 };
    counts.total++;
    if (task.status === "done") counts.done++;
    projectTaskCounts.set(projectId, counts);
  }

  // Build stats for active projects only
  const activeProjects = projects.filter((p) => p.status === "active");
  const stats: ProjectStat[] = activeProjects
    .map((project) => {
      const counts = projectTaskCounts.get(project.id) ?? { done: 0, total: 0 };
      return {
        project,
        done: counts.done,
        total: counts.total,
        percentage: counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
      };
    })
    .sort((a, b) => a.percentage - b.percentage);

  return (
    <Card>
      <CardHeader className={styles.headerRow}>
        <CardTitle className={styles.cardTitle}>Project Progress</CardTitle>
        <Link to="/projects" className={styles.viewAllLink}>
          View all &rarr;
        </Link>
      </CardHeader>
      <CardContent>
        {stats.length === 0 ? (
          <div className={styles.emptyState}>
            <BarChart3 className={styles.emptyIcon} />
            <p className={styles.emptyText}>No active projects</p>
          </div>
        ) : (
          <div className={styles.projectList}>
            {stats.map(({ project, done, total, percentage }) => (
              <div key={project.id} className={styles.projectRow}>
                <div className={styles.projectHeader}>
                  <Badge variant="outline" className={styles.codeBadge}>
                    {project.code ?? project.id.slice(0, 6)}
                  </Badge>
                  <span className={styles.projectName}>
                    {project.name?.name ?? "Untitled"}
                  </span>
                  <span className={styles.progressCount}>
                    {done}/{total} done
                  </span>
                </div>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressBar}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
