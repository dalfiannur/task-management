import { useAllTasks } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { useNewLeads } from "@/hooks/use-leads";
import { useIsManager } from "@/hooks/use-me";
import { StatCard } from "@/components/dashboard/stat-card";
import { TaskDistribution } from "@/components/dashboard/task-distribution";
import { NewLeads } from "@/components/dashboard/new-leads";
import { ActiveProjects } from "@/components/dashboard/active-projects";
import { RecentTasks } from "@/components/dashboard/recent-tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { ListTodo, Timer, Eye, FolderOpen } from "lucide-react";
import { format } from "date-fns";
import styles from "./dashboard.module.css";

const STAT_ACCENTS = {
  tasks: "#3b82f6",
  progress: "#f59e0b",
  review: "#8b5cf6",
  projects: "#10b981",
};

export function Component() {
  const { data: tasks, isLoading: tasksLoading } = useAllTasks();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const isManager = useIsManager();
  const { data: leads, isLoading: leadsLoading } = useNewLeads();

  const isLoading =
    tasksLoading || projectsLoading || (isManager && leadsLoading);

  if (isLoading) {
    return (
      <div className={styles.skeletonPage}>
        <div className={styles.skeletonHeader}>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className={styles.skeletonStatsGrid}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
        <div className={styles.skeletonContentGrid}>
          <div className={styles.skeletonMainCol}>
            <Skeleton className="h-72" />
            <Skeleton className="h-48" />
          </div>
          <div className={styles.skeletonSideCol}>
            <Skeleton className="h-64" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </div>
    );
  }

  const allTasks = tasks ?? [];
  const allProjects = projects ?? [];
  const today = new Date();

  const totalTasks = allTasks.length;
  const inProgressTasks = allTasks.filter(
    (t) => t.status === "in_progress",
  ).length;
  const inReviewTasks = allTasks.filter(
    (t) => t.status === "in_review",
  ).length;
  const activeProjects = allProjects.filter(
    (p) => p.status.value === "on_going",
  ).length;

  const stats = [
    {
      title: "Total Tasks",
      value: totalTasks,
      icon: ListTodo,
      accent: STAT_ACCENTS.tasks,
      desc: "Across all modules",
    },
    {
      title: "In Progress",
      value: inProgressTasks,
      icon: Timer,
      accent: STAT_ACCENTS.progress,
      desc: "Currently active",
    },
    {
      title: "Pending Review",
      value: inReviewTasks,
      icon: Eye,
      accent: STAT_ACCENTS.review,
      desc: "Awaiting review",
    },
    {
      title: "Active Projects",
      value: activeProjects,
      icon: FolderOpen,
      accent: STAT_ACCENTS.projects,
      desc: "On-going",
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.pageSpacing}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>
            Dashboard
          </h1>
          <p className={styles.headerSubtitle}>
            {format(today, "EEEE, MMMM d, yyyy")} &middot; {totalTasks}{" "}
            {totalTasks === 1 ? "task" : "tasks"} across {allProjects.length}{" "}
            {allProjects.length === 1 ? "project" : "projects"}
          </p>
        </div>

        {/* Stats Grid */}
        <div className={styles.statsGrid}>
          {stats.map((stat, i) => (
            <div
              key={stat.title}
              className={styles.statItem}
              style={{ animationDelay: `${i * 75 + 50}ms` }}
            >
              <StatCard
                title={stat.title}
                value={stat.value}
                icon={stat.icon}
                accentColor={stat.accent}
                description={stat.desc}
              />
            </div>
          ))}
        </div>

        {/* Content Grid */}
        <div className={styles.contentGrid}>
          <div
            className={styles.mainCol}
            style={{ animationDelay: "400ms" }}
          >
            <TaskDistribution tasks={allTasks} />
            {isManager && <NewLeads projects={leads ?? []} />}
          </div>
          <div
            className={styles.sideCol}
            style={{ animationDelay: "500ms" }}
          >
            <ActiveProjects projects={allProjects} />
            <RecentTasks tasks={allTasks} />
          </div>
        </div>
      </div>
    </div>
  );
}
