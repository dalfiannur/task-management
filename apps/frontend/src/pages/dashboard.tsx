import { useAllTasks, getTodayDeadlines } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";

import { useMe, useIsManager } from "@/hooks/use-me";
import { useAllModules } from "@/hooks/use-modules";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { StatCard } from "@/components/dashboard/stat-card";
import { MyAssignedTasks } from "@/components/dashboard/my-assigned-tasks";
import { UpcomingDeadlines } from "@/components/dashboard/upcoming-deadlines";
import { ProjectProgress } from "@/components/dashboard/project-progress";
import { TeamActivityFeed } from "@/components/dashboard/team-activity-feed";
import { ActiveProjects } from "@/components/dashboard/active-projects";
import { RecentTasks } from "@/components/dashboard/recent-tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { ListTodo, Timer, CheckCircle2, FolderOpen } from "lucide-react";
import { format } from "date-fns";
import { useCompanyStore } from "@/stores/company-store";
import styles from "./dashboard.module.css";

const STAT_ACCENTS = {
  tasks: "#3b82f6",
  progress: "#f59e0b",
  done: "#10b981",
  projects: "#8b5cf6",
};

export function Component() {
  const { data: me } = useMe();
  const { data: tasks, isLoading: tasksLoading } = useAllTasks();
  const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
  const { data: projects, isLoading: projectsLoading } = useProjects(selectedCompanyId ? { ownerId: selectedCompanyId } : undefined);
  const { data: modules, isLoading: modulesLoading } = useAllModules();
  const isManager = useIsManager();

  // Active projects: proposal or won winStage
  const activeProjectIds = (projects ?? [])
    .filter((p) => p.status === "active" && (p.winStage === "proposal" || p.winStage === "won"))
    .map((p) => p.id);

  const { data: stats, isLoading: statsLoading } = useDashboardStats(activeProjectIds);

  const isLoading = tasksLoading || projectsLoading || modulesLoading || statsLoading;

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
  const allModules = modules ?? [];
  const today = new Date();

  // Filter to tasks from active projects (proposal/won)
  const activeProjectIdSet = new Set(activeProjectIds);
  const activeModuleIds = new Set(
    allModules.filter((m) => activeProjectIdSet.has(m.projectId)).map((m) => m.id),
  );
  const activeTasks = allTasks.filter((t) => activeModuleIds.has(t.moduleId));

  // Stats from backend (scoped to current user + active projects)
  const totalTasks = stats?.totalTasks ?? 0;
  const inProgressTasks = stats?.inProgressTasks ?? 0;
  const doneTasks = stats?.doneTasks ?? 0;
  const activeProjectCount = activeProjectIds.length;

  // Derived data
  const myTasks = me
    ? activeTasks.filter((t) => t.assigneeIds.includes(me.id))
    : [];
  const deadlineTasks = getTodayDeadlines(activeTasks);

  const statCards = [
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
      title: "Done",
      value: doneTasks,
      icon: CheckCircle2,
      accent: STAT_ACCENTS.done,
      desc: "Completed tasks",
    },
    {
      title: "Active Projects",
      value: activeProjectCount,
      icon: FolderOpen,
      accent: STAT_ACCENTS.projects,
      desc: "On-going & Proposal",
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.pageSpacing}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>Dashboard</h1>
          <p className={styles.headerSubtitle}>
            {format(today, "EEEE, MMMM d, yyyy")} &middot; {totalTasks}{" "}
            {totalTasks === 1 ? "task" : "tasks"} across {activeProjectCount}{" "}
            {activeProjectCount === 1 ? "project" : "projects"}
          </p>
        </div>

        {/* Stats Grid */}
        <div className={styles.statsGrid}>
          {statCards.map((stat, i) => (
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

        {/* Content Grid — role-based layout */}
        {isManager ? (
          <>
            {/* Manager: oversight-first */}
            <div className={styles.contentGrid}>
              <div className={styles.mainCol} style={{ animationDelay: "400ms" }}>
                <ProjectProgress
                  projects={allProjects}
                  tasks={activeTasks}
                  modules={allModules}
                />
              </div>
              <div className={styles.sideCol} style={{ animationDelay: "500ms" }}>
                <UpcomingDeadlines tasks={deadlineTasks} />
              </div>
            </div>
            <div className={styles.contentGrid}>
              <div className={styles.mainCol} style={{ animationDelay: "550ms" }}>
                <TeamActivityFeed />
              </div>
              <div className={styles.sideCol} style={{ animationDelay: "600ms" }}>
                <ActiveProjects projects={allProjects} />
              </div>
            </div>
            <div className={styles.contentGrid}>
              <div className={styles.mainCol} style={{ animationDelay: "650ms" }}>
                <RecentTasks tasks={activeTasks} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Member: personal-first */}
            <div className={styles.contentGrid}>
              <div className={styles.mainCol} style={{ animationDelay: "400ms" }}>
                <MyAssignedTasks tasks={myTasks} />
              </div>
              <div className={styles.sideCol} style={{ animationDelay: "500ms" }}>
                <UpcomingDeadlines tasks={deadlineTasks} />
              </div>
            </div>
            <div className={styles.contentGrid}>
              <div className={styles.mainCol} style={{ animationDelay: "550ms" }}>
                <ProjectProgress
                  projects={allProjects}
                  tasks={activeTasks}
                  modules={allModules}
                />
              </div>
              <div className={styles.sideCol} style={{ animationDelay: "600ms" }}>
                <RecentTasks tasks={activeTasks} />
              </div>
            </div>
            <div className={styles.fullWidth} style={{ animationDelay: "650ms" }}>
              <TeamActivityFeed />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
