import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useState } from "react";
import {
  useProject,
  useDeleteProject,
  getProjectDisplayName,
} from "@/hooks/use-projects";
import { useModules } from "@/hooks/use-modules";
import { useUser } from "@/hooks/use-users";
import { useTasks } from "@/hooks/use-tasks";
import { ModuleForm } from "@/components/modules/module-form";
import { WinProjectDialog } from "@/components/projects/win-project-dialog";
import { CloseProjectDialog } from "@/components/projects/close-project-dialog";
import { SubProjectForm } from "@/components/projects/sub-project-form";
import { ProjectMembersDialog } from "@/components/projects/project-members-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MoreHorizontal,
  Users,
  Trophy,
  Trash2,
  CheckCircle2,
  Clock,
  CircleDot,
  Building,
  ArrowLeft,
  Loader2,
  LayoutList,
  GanttChart as GanttChartIcon,
  Image as ImageIcon,
  FileText,
  FolderOpen,
  Lock,
} from "lucide-react";
import { PROJECT_STATUS_CONFIG, type ProjectStatus } from "@/types/project";
import { cn, getInitials } from "@/lib/utils";
import styles from "./project-layout.module.css";

const DOT_CLASS: Record<string, string> = {
  pending: styles.dotPending,
  prospect: styles.dotProspect,
  win: styles.dotWin,
  won: styles.dotWon,
  on_going: styles.dotOnGoing,
  canceled: styles.dotCanceled,
  closed: styles.dotClosed,
};

export interface ProjectLayoutContext {
  openModuleForm: () => void;
  openSubProjectForm: () => void;
}

export function Component() {
  const { projectId, pageId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(projectId!);
  const { data: modules } = useModules(projectId);
  const { data: pic } = useUser(project?.projectLeaderId?.value);
  const { data: allTasks } = useTasks();
  const deleteProject = useDeleteProject();

  const [formOpen, setFormOpen] = useState(false);
  const [winDialogOpen, setWinDialogOpen] = useState(false);
  const [subProjectFormOpen, setSubProjectFormOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Loader2 className={styles.loadingIcon} />
      </div>
    );
  }

  if (!project) {
    return <div className={styles.notFound}>Project not found</div>;
  }

  const resolvedStatus = (project.resolvedStatus ?? project.status.value) as ProjectStatus;
  const statusConfig = PROJECT_STATUS_CONFIG[resolvedStatus];
  const dotClass = DOT_CLASS[resolvedStatus] ?? DOT_CLASS.pending;

  // Task stats
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

  const showWin =
    project.winStage === "won" &&
    project.status.value === "prospect";

  // Active tab detection
  const basePath = `/projects/${projectId}`;
  const isPageEditor = !!pageId;
  const pathname = location.pathname;

  let activeTab = "overview";
  if (pathname.startsWith(`${basePath}/timeline`)) activeTab = "timeline";
  else if (pathname.startsWith(`${basePath}/sub-projects`)) activeTab = "sub-projects";
  else if (pathname.startsWith(`${basePath}/media`)) activeTab = "media";
  else if (pathname.startsWith(`${basePath}/pages`)) activeTab = "pages";

  const tabs = [
    { key: "overview", label: "Tasks", to: basePath, icon: LayoutList },
    {
      key: "timeline",
      label: "Timeline",
      to: `${basePath}/timeline`,
      icon: GanttChartIcon,
    },
    {
      key: "sub-projects",
      label: "Sub-Projects",
      to: `${basePath}/sub-projects`,
      icon: FolderOpen,
    },
    {
      key: "media",
      label: "Media & Files",
      to: `${basePath}/media`,
      icon: ImageIcon,
    },
    {
      key: "pages",
      label: "Pages",
      to: `${basePath}/pages`,
      icon: FileText,
    },
  ];

  const outletContext: ProjectLayoutContext = {
    openModuleForm: () => setFormOpen(true),
    openSubProjectForm: () => setSubProjectFormOpen(true),
  };

  return (
    <div>
      {/* Compact Header */}
      <div className={styles.header}>
        <div className={styles.topRow}>
          <div className={styles.badges}>
            <Badge variant="outline" className={styles.codeBadge}>
              {project.code}
            </Badge>
            <Badge className={cn(statusConfig.color, styles.statusBadge)}>
              <span className={cn(styles.statusDot, dotClass)} />
              {statusConfig.label}
            </Badge>
          </div>

          <div className={styles.headerActions}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={styles.moreBtn}
                >
                  <MoreHorizontal className={styles.moreBtnIcon} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setMembersOpen(true)}>
                  <Users className={styles.menuIcon} />
                  Members
                </DropdownMenuItem>
                {project.status.value === "on_going" && (
                  <DropdownMenuItem
                    className={styles.closeItem}
                    onClick={() => setCloseDialogOpen(true)}
                  >
                    <Lock className={styles.menuIcon} />
                    Close Project
                  </DropdownMenuItem>
                )}
                {showWin && (
                  <DropdownMenuItem
                    className={styles.winItem}
                    onClick={() => setWinDialogOpen(true)}
                  >
                    <Trophy className={styles.menuIcon} />
                    WIN
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={styles.deleteItem}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className={styles.menuIcon} />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

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
              <span className={styles.picLabel}>Leader</span>
              <Avatar className={styles.picAvatar}>
                <AvatarImage src={pic.avatarUrl} />
                <AvatarFallback className={styles.picAvatarFallback}>
                  {getInitials(pic.name)}
                </AvatarFallback>
              </Avatar>
              <span className={styles.picName}>{pic.name}</span>
            </div>
          )}
          {project.clientName && (
            <div className={styles.clientInfo}>
              <span className={styles.descSeparator}>&middot;</span>
              <Building className={styles.clientIcon} />
              <span className={styles.clientName}>
                {project.clientName}
              </span>
            </div>
          )}
          {project.coreDescription && (
            <div className={styles.descriptionRow}>
              <span className={styles.descSeparator}>&middot;</span>
              <span className={styles.descClamp}>
                {project.coreDescription}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Strip */}
      {totalTasks > 0 && (
        <div className={styles.statsStrip}>
          <div className={styles.statsGroup}>
            <div className={styles.statItem}>
              <CheckCircle2 className={styles.statIconDone} />
              <span className={styles.statValue}>{doneTasks}</span>
              <span className={styles.statLabel}>done</span>
            </div>
            <div className={styles.statItem}>
              <Clock className={styles.statIconProgress} />
              <span className={styles.statValue}>{inProgressTasks}</span>
              <span className={styles.statLabel}>in progress</span>
            </div>
            <div className={styles.statItem}>
              <CircleDot className={styles.statIconTotal} />
              <span className={styles.statValue}>{totalTasks}</span>
              <span className={styles.statLabel}>total</span>
            </div>
          </div>
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
            <span className={styles.progressPct}>{completionPct}%</span>
          </div>
        </div>
      )}

      {/* Tab Navigation — hidden on page editor */}
      {!isPageEditor && (
        <nav className={styles.tabNav}>
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              className={cn(
                styles.tabLink,
                activeTab === tab.key && styles.tabLinkActive,
              )}
            >
              <tab.icon className={styles.tabIcon} />
              {tab.label}
            </Link>
          ))}
        </nav>
      )}

      {/* Child route content */}
      <div className={styles.content}>
        <Outlet context={outletContext} />
      </div>

      {/* Dialogs */}
      <ModuleForm
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId!}
      />
      {showWin && (
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
        projectLeaderId={project?.projectLeaderId?.value}
      />
      {project.status.value === "on_going" && (
        <CloseProjectDialog
          project={project}
          open={closeDialogOpen}
          onOpenChange={setCloseDialogOpen}
        />
      )}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the project &quot;
              {getProjectDisplayName(project)}&quot; and all its modules and
              tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={styles.deleteDialogAction}
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
    </div>
  );
}
