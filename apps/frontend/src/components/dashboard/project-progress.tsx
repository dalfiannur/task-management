import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CoreProject } from "@/types/project";
import type { ProjectProgressData } from "@/hooks/use-dashboard";
import { BarChart3 } from "lucide-react";
import styles from "./project-progress.module.css";

interface ProjectProgressProps {
  projects: CoreProject[];
  progressData: ProjectProgressData[];
}

interface ProjectStat {
  project: CoreProject;
  done: number;
  total: number;
  percentage: number;
}

export function ProjectProgress({ projects, progressData }: ProjectProgressProps) {
  // Build progress lookup by coreProjectId
  const progressMap = new Map<string, ProjectProgressData>();
  for (const p of progressData) {
    progressMap.set(p.coreProjectId, p);
  }

  // Build stats for active projects only
  const activeProjects = projects.filter((p) => p.status === "active");
  const stats: ProjectStat[] = activeProjects
    .map((project) => {
      const progress = progressMap.get(project.id);
      const done = progress?.done ?? 0;
      const total = progress?.total ?? 0;
      return {
        project,
        done,
        total,
        percentage: total > 0 ? Math.round((done / total) * 100) : 0,
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
