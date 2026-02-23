import { Link, useParams, useSearchParams, useNavigate } from "react-router";
import {
  useProject,
  useDeleteProject,
  useSubProjects,
  getProjectDisplayName,
} from "@/hooks/use-projects";
import { useModules } from "@/hooks/use-modules";
import { useUser } from "@/hooks/use-users";
import { useTasks } from "@/hooks/use-tasks";
import { ModuleSection } from "@/components/modules/module-section";
import { ModuleForm } from "@/components/modules/module-form";
import { TaskFilters } from "@/components/tasks/task-filters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  ImageIcon,
  Search,
  Trophy,
  GanttChart as GanttChartIcon,
  Trash2,
  Building,
  CheckCircle2,
  Clock,
  CircleDot,
  FileText,
  FolderPlus,
  ArrowLeft,
  ChevronRight,
  Users,
} from "lucide-react";
import { WinProjectDialog } from "@/components/projects/win-project-dialog";
import { SubProjectForm } from "@/components/projects/sub-project-form";
import { ProjectMembersDialog } from "@/components/projects/project-members-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { useState } from "react";
import { PROJECT_STATUS_CONFIG } from "@/types/project";
import { cn, getInitials } from "@/lib/utils";
import styles from "./project-detail.module.css";

const STATUS_CLASS: Record<string, string> = {
  pending: styles.heroHeaderPending,
  prospect: styles.heroHeaderProspect,
  win: styles.heroHeaderWin,
  won: styles.heroHeaderWon,
  on_going: styles.heroHeaderOnGoing,
  canceled: styles.heroHeaderCanceled,
};

const DOT_CLASS: Record<string, string> = {
  pending: styles.dotPending,
  prospect: styles.dotProspect,
  win: styles.dotWin,
  won: styles.dotWon,
  on_going: styles.dotOnGoing,
  canceled: styles.dotCanceled,
};

export function Component() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get("status") ?? undefined;
  const priority = searchParams.get("priority") ?? undefined;
  const search = searchParams.get("search") ?? undefined;

  const { data: project } = useProject(projectId!);
  const { data: modules } = useModules(projectId);
  const { data: pic } = useUser(project?.picId?.value);
  const { data: allTasks } = useTasks();
  const { data: subProjects } = useSubProjects(projectId);
  const deleteProject = useDeleteProject();
  const [formOpen, setFormOpen] = useState(false);
  const [winDialogOpen, setWinDialogOpen] = useState(false);
  const [subProjectFormOpen, setSubProjectFormOpen] = useState(false);
  const [subProjectsExpanded, setSubProjectsExpanded] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);

  if (!project) {
    return (
      <div className={styles.notFound}>
        Project not found
      </div>
    );
  }

  const resolvedStatus =
    project.coreDetail?.winStage === "won" &&
    project.status.value === "prospect"
      ? "won"
      : project.status.value;

  const statusConfig = PROJECT_STATUS_CONFIG[resolvedStatus];
  const heroClass = STATUS_CLASS[resolvedStatus] ?? STATUS_CLASS.pending;
  const dotClass = DOT_CLASS[resolvedStatus] ?? DOT_CLASS.pending;

  // Compute project-level task stats from all modules
  const projectModuleIds = new Set(modules?.map((m) => m.id) ?? []);
  const projectTasks = (allTasks ?? []).filter((t) =>
    projectModuleIds.has(t.moduleId),
  );
  const totalTasks = projectTasks.length;
  const doneTasks = projectTasks.filter((t) => t.status === "done").length;
  const inProgressTasks = projectTasks.filter(
    (t) => t.status === "in_progress",
  ).length;
  const completionPct =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div>
      {/* Hero Header */}
      <div className={cn(styles.heroHeader, heroClass)}>
        <div className={styles.heroInner}>
          {/* Top row: badges + actions */}
          <div className={styles.topRow}>
            <div className={styles.badges}>
              <Badge
                variant="outline"
                className={styles.codeBadge}
              >
                {project.coreDetail?.code}
              </Badge>
              <Badge className={cn(statusConfig.color, styles.statusBadge)}>
                <span
                  className={cn(styles.statusDot, dotClass)}
                />
                {statusConfig.label}
              </Badge>
            </div>

            <div className={styles.actions}>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.deleteBtn}
                  >
                    <Trash2 className={styles.btnIcon} />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the project &quot;
                      {getProjectDisplayName(project)}&quot; and all its modules
                      and tasks.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        deleteProject.mutate(projectId!, {
                          onSuccess: () => navigate("/projects"),
                        })
                      }
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                size="sm"
                variant="outline"
                className={styles.actionBtn}
                asChild
              >
                <Link to={`/projects/${projectId}/timeline`}>
                  <GanttChartIcon className={styles.btnIcon} />
                  Timeline
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={styles.actionBtn}
                asChild
              >
                <Link to={`/projects/${projectId}/pages`}>
                  <FileText className={styles.btnIcon} />
                  Pages
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={styles.actionBtn}
                asChild
              >
                <Link to={`/projects/${projectId}/media`}>
                  <ImageIcon className={styles.btnIcon} />
                  Media & Files
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={styles.actionBtn}
                onClick={() => setMembersOpen(true)}
              >
                <Users className={styles.btnIcon} />
                Members
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={styles.actionBtn}
                onClick={() => setSubProjectFormOpen(true)}
              >
                <FolderPlus className={styles.btnIcon} />
                Sub-Project
              </Button>
              {project.coreDetail?.winStage === "won" &&
                project.status.value === "prospect" && (
                  <Button
                    size="sm"
                    className={styles.winBtn}
                    onClick={() => setWinDialogOpen(true)}
                  >
                    <Trophy className={styles.btnIcon} />
                    WIN
                  </Button>
                )}
              {project.status.value === "on_going" && (
                <Button
                  size="sm"
                  className={styles.actionBtn}
                  onClick={() => setFormOpen(true)}
                >
                  <Plus className={styles.btnIcon} />
                  New Module
                </Button>
              )}
            </div>
          </div>

          {/* Title + PM + PIC */}
          {project.parent && (
            <Link
              to={`/projects/${project.parent.id}`}
              className={styles.parentLink}
            >
              <ArrowLeft className={styles.parentLinkIcon} />
              Back to parent project
            </Link>
          )}
          <h1 className={styles.projectTitle}>
            {getProjectDisplayName(project)}
          </h1>
          <div className={styles.metaRow}>
            {pic && (
              <div className={styles.picInfo}>
                <span className={styles.picLabel}>
                  PIC
                </span>
                <Avatar className={styles.picAvatar}>
                  <AvatarImage src={pic.avatarUrl} />
                  <AvatarFallback className={styles.picAvatarFallback}>
                    {getInitials(pic.name)}
                  </AvatarFallback>
                </Avatar>
                <span className={styles.picName}>
                  {pic.name}
                </span>
              </div>
            )}
            {project.coreDetail?.clientDetail?.name.name && (
              <div className={styles.clientInfo}>
                <span className={styles.descSeparator}>&middot;</span>
                <Building className={styles.clientIcon} />
                <span className={styles.clientName}>
                  {project.coreDetail.clientDetail.name.name}
                </span>
              </div>
            )}
            {project.coreDetail?.name.description && (
              <div className={styles.descriptionRow}>
                <span className={styles.descSeparator}>&middot;</span>
                <span className={styles.descClamp}>
                  {project.coreDetail.name.description}
                </span>
              </div>
            )}
          </div>

          {/* Quick Stats Strip */}
          {totalTasks > 0 && (
            <div
              className={styles.statsStrip}
              style={{ animationDelay: "100ms" }}
            >
              <div className={styles.statsGroup}>
                <div className={styles.statItem}>
                  <CheckCircle2 className={styles.statIconDone} />
                  <span className={styles.statValue}>
                    {doneTasks}
                  </span>
                  <span className={styles.statLabel}>done</span>
                </div>
                <div className={styles.statItem}>
                  <Clock className={styles.statIconProgress} />
                  <span className={styles.statValue}>
                    {inProgressTasks}
                  </span>
                  <span className={styles.statLabel}>
                    in progress
                  </span>
                </div>
                <div className={styles.statItem}>
                  <CircleDot className={styles.statIconTotal} />
                  <span className={styles.statValue}>
                    {totalTasks}
                  </span>
                  <span className={styles.statLabel}>total</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className={styles.progressWrapper}>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${completionPct}%`,
                      transformOrigin: "left",
                      animation: "bar-fill 0.8s ease-out both",
                      animationDelay: "300ms",
                    }}
                  />
                </div>
                <span className={styles.progressPct}>
                  {completionPct}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-Projects */}
      {subProjects && subProjects.length > 0 && (
        <div className={styles.subProjectsSection}>
          <button
            type="button"
            className={styles.subProjectsToggle}
            onClick={() => setSubProjectsExpanded((v) => !v)}
          >
            <ChevronRight
              className={cn(styles.chevronIcon, subProjectsExpanded && styles.chevronExpanded)}
            />
            Sub-Projects
            <span className={styles.subProjectsCount}>
              ({subProjects.length})
            </span>
          </button>
          {subProjectsExpanded && (
            <div className={styles.subProjectsGrid}>
              {subProjects.map((sub) => (
                <ProjectCard key={sub.id} project={sub} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters Row */}
      <div
        className={styles.filtersRow}
        style={{ animationDelay: "150ms" }}
      >
        <TaskFilters filters={{ status, priority }} />
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} />
          <input
            placeholder="Search tasks..."
            value={search ?? ""}
            onChange={(e) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("search", e.target.value);
                else next.delete("search");
                return next;
              })
            }
            className={styles.searchInput}
          />
        </div>
      </div>

      {/* Module List */}
      <div className={styles.moduleList}>
        {modules?.map((mod, index) => (
          <div
            key={mod.id}
            className={styles.moduleItem}
            style={{ animationDelay: `${index * 75 + 200}ms` }}
          >
            <ModuleSection
              module={mod}
              projectId={projectId!}
              colorIndex={index}
              filters={{ status, priority, search }}
              projectStatus={project.status.value}
            />
          </div>
        ))}
      </div>
      {modules?.length === 0 && (
        <div className={styles.emptyState}>
          <CircleDot className={styles.emptyIcon} />
          <div className={styles.emptyText}>
            <p className={styles.emptyTitle}>No modules yet</p>
            <p className={styles.emptySubtitle}>
              Create a module to start organizing tasks.
            </p>
          </div>
          {project.status.value === "on_going" && (
            <Button
              size="sm"
              variant="outline"
              className={styles.emptyBtn}
              onClick={() => setFormOpen(true)}
            >
              <Plus className={styles.emptyBtnIcon} />
              Create Module
            </Button>
          )}
        </div>
      )}
      <ModuleForm
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId!}
      />
      {project.coreDetail?.winStage === "won" &&
        project.status.value === "prospect" && (
          <WinProjectDialog
            project={project}
            open={winDialogOpen}
            onOpenChange={setWinDialogOpen}
          />
        )}
      <SubProjectForm
        open={subProjectFormOpen}
        onOpenChange={setSubProjectFormOpen}
        parentProjectId={projectId!}
      />
      <ProjectMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        projectId={projectId!}
        picId={project?.picId?.value}
      />
    </div>
  );
}
