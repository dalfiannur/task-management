import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useState } from "react";
import {
  useProject,
  useLocalProject,
  useSubProjects,
  useLocalSubProjects,
  useDeleteProject,
  useUpdateLocalProject,
  getProjectDisplayName,
} from "@/hooks/use-projects";
import { useModules } from "@/hooks/use-modules";
import { useUser } from "@/hooks/use-users";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/use-me";
import { client, coreClient } from "@/lib/graphql-client";
import { useProjectTaskStats } from "@/hooks/use-dashboard";
import { ModuleForm } from "@/components/modules/module-form";
import { AssignLeaderDialog } from "@/components/projects/win-project-dialog";
import { CloseProjectDialog } from "@/components/projects/close-project-dialog";
import { SubProjectForm } from "@/components/projects/sub-project-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Layers,
} from "lucide-react";
import { PROJECT_STATUS_CONFIG, getDisplayStatus } from "@/types/project";
import { cn, getInitials } from "@/lib/utils";

const DOT_CLASS: Record<string, string> = {
  draft: "bg-gray-400",
  pending: "bg-gray-400",
  proposal: "bg-yellow-400",
  won: "bg-emerald-400",
  active: "bg-blue-400",
  completed: "bg-purple-500",
  archived: "bg-red-400",
  lost: "bg-red-400",
};

export interface ProjectLayoutContext {
  openModuleForm: () => void;
  openSubProjectForm: () => void;
  subProjectCountsByModule: Map<string, number>;
}

export function Component() {
  const { projectId, pageId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(projectId!);
  const { data: localProject, error: localProjectError } = useLocalProject(projectId!);
  const { data: pic } = useUser(project?.ref?.leaderId);
  const { data: taskStats } = useProjectTaskStats(projectId);
  const { data: subProjects } = useSubProjects(projectId);
  const { data: localSubProjects } = useLocalSubProjects(projectId);
  const deleteProject = useDeleteProject();
  const isAdmin = useIsAdmin();
  const updateLocalProject = useUpdateLocalProject();
  const { data: parentLocalProject } = useLocalProject(project?.ref?.parentId ?? "");
  const { data: parentModules } = useModules(project?.ref?.parentId);

  const [formOpen, setFormOpen] = useState(false);
  const [winDialogOpen, setWinDialogOpen] = useState(false);
  const [subProjectFormOpen, setSubProjectFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="size-7 text-muted-foreground animate-spin" />
      </div>
    );
  }

  const isForbidden = localProjectError?.message?.includes("not a project member");

  if (isForbidden) {
    return (
      <div className="flex flex-col items-center justify-center p-10 gap-3">
        <Lock className="size-10 text-muted-foreground/50" />
        <p className="text-muted-foreground font-medium">You don't have access to this project</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/projects")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  if (!project) {
    return <div className="p-5 text-center text-muted-foreground">Project not found</div>;
  }

  const resolvedStatus = getDisplayStatus(project);
  const statusConfig = PROJECT_STATUS_CONFIG[resolvedStatus] ?? {
    label: resolvedStatus,
    color: "bg-gray-100 text-gray-700",
  };
  const dotClass = DOT_CLASS[resolvedStatus] ?? DOT_CLASS.pending;

  // Task stats from lightweight endpoint
  const totalTasks = taskStats?.totalTasks ?? 0;
  const doneTasks = taskStats?.doneTasks ?? 0;
  const inProgressTasks = taskStats?.inProgressTasks ?? 0;
  const completionPct =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const showWin = resolvedStatus === "won";

  // Active tab detection
  const basePath = `/projects/${projectId}`;
  const isPageEditor = !!pageId;
  const pathname = location.pathname;

  let activeTab = "all-tasks";
  if (pathname.startsWith(`${basePath}/all-tasks`)) activeTab = "all-tasks";
  else if (pathname.startsWith(`${basePath}/timeline`)) activeTab = "timeline";
  else if (pathname.startsWith(`${basePath}/sub-projects`)) activeTab = "sub-projects";
  else if (pathname.startsWith(`${basePath}/media`)) activeTab = "media";
  else if (pathname.startsWith(`${basePath}/members`)) activeTab = "members";
  else if (pathname.startsWith(`${basePath}/pages`)) activeTab = "pages";

  const isSubProject = !!project.ref?.parentId;

  const allTabs = [
    { key: "all-tasks", label: "All Tasks", to: `${basePath}/all-tasks`, icon: LayoutList },
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
      count: subProjects?.length,
    },
    {
      key: "members",
      label: "Members",
      to: `${basePath}/members`,
      icon: Users,
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

  // Hide sub-projects tab for sub-projects (single-level nesting only)
  const tabs = isSubProject ? allTabs.filter((t) => t.key !== "sub-projects") : allTabs;

  // Compute sub-project counts by linked module (uses local data)
  const subProjectCountsByModule = new Map<string, number>();
  for (const sp of localSubProjects ?? []) {
    if (sp.linkedModule?.id) {
      subProjectCountsByModule.set(
        sp.linkedModule.id,
        (subProjectCountsByModule.get(sp.linkedModule.id) ?? 0) + 1,
      );
    }
  }

  const outletContext: ProjectLayoutContext = {
    openModuleForm: () => setFormOpen(true),
    openSubProjectForm: () => { if (!isSubProject) setSubProjectFormOpen(true); },
    subProjectCountsByModule,
  };

  return (
    <div>
      {/* Hero Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border bg-muted/15 animate-[fade-up_0.4s_ease-out_both]">
        <div className="flex items-center justify-between gap-2.5 mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-[family-name:var(--font-mono)] text-sm tracking-wide border-primary/30">
              {project.code}
            </Badge>
            <Badge className={cn(statusConfig.color, "border-0 text-sm font-[family-name:var(--font-mono)]")}>
              <span className={cn("size-1.5 rounded-full mr-1.5 inline-block", dotClass)} />
              {statusConfig.label}
            </Badge>
          </div>

          <div className="flex items-center gap-1.5">
            {showWin && (
              <Button
                variant="outline"
                size="sm"
                className="text-emerald-600 border-emerald-600 h-7 text-xs font-semibold gap-1 hover:bg-emerald-600/10"
                onClick={() => setWinDialogOpen(true)}
              >
                <Trophy className="size-3.5" />
                Assign Project Leader
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {resolvedStatus === "active" && (
                  <DropdownMenuItem
                    className="text-violet-600 focus:text-violet-600"
                    onClick={() => setCloseDialogOpen(true)}
                  >
                    <Lock className="size-3.5 mr-1.5" />
                    Close Project
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="size-3.5 mr-1.5" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {project.ref?.parentId && parentLocalProject && (
          <Link
            to={`/projects/${project.ref.parentId}`}
            className="text-sm leading-4 text-primary flex items-center gap-1 mb-1 font-[family-name:var(--font-mono)] hover:text-primary/80 transition-colors"
          >
            <ArrowLeft className="size-3" />
            Back to parent project
          </Link>
        )}

        <h1 className="text-[22px] leading-7 font-bold tracking-tight">
          {getProjectDisplayName(project)}
        </h1>

        <div className="flex items-center gap-3 mt-1.5">
          {project.ref?.parentId && parentLocalProject && parentModules && parentModules.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Layers className="size-[0.8125rem] text-muted-foreground shrink-0" />
              <Select
                value={localProject?.linkedModule?.id ?? "__none__"}
                onValueChange={(v) => {
                  updateLocalProject.mutate({
                    id: localProject!.id,
                    moduleId: v === "__none__" ? null : v,
                  });
                }}
              >
                <SelectTrigger className="h-6 text-sm border-border/60 w-auto min-w-32 shadow-none">
                  <SelectValue placeholder="Link module..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No module</SelectItem>
                  {parentModules.map((mod) => (
                    <SelectItem key={mod.id} value={mod.id}>
                      {mod.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {pic && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary/60 font-[family-name:var(--font-mono)]">Leader</span>
              <Avatar className="size-6 ring-2 ring-primary/20">
                <AvatarImage src={pic.avatarUrl} />
                <AvatarFallback className="text-[9px]">
                  {getInitials(pic.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground">{pic.name}</span>
            </div>
          )}
          {project.clientDetail?.name.name && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground/40">&middot;</span>
              <Building className="size-[0.8125rem] text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                {project.clientDetail.name.name}
              </span>
            </div>
          )}
          {project.name?.description && (
            <div className="flex items-center text-sm text-muted-foreground/80">
              <span className="text-muted-foreground/40">&middot;</span>
              <span className="line-clamp-1">
                {project.name.description}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Strip */}
      {totalTasks > 0 && (
        <div className="flex items-center gap-4 px-6 py-3.5 border-b border-border bg-muted/8 animate-[fade-up_0.4s_ease-out_both] [animation-delay:100ms]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              <span className="text-sm font-semibold tabular-nums font-[family-name:var(--font-mono)]">{doneTasks}</span>
              <span className="text-sm text-muted-foreground font-[family-name:var(--font-mono)]">done</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="size-3.5 text-primary" />
              <span className="text-sm font-semibold tabular-nums font-[family-name:var(--font-mono)]">{inProgressTasks}</span>
              <span className="text-sm text-muted-foreground font-[family-name:var(--font-mono)]">in progress</span>
            </div>
            <div className="flex items-center gap-1">
              <CircleDot className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold tabular-nums font-[family-name:var(--font-mono)]">{totalTasks}</span>
              <span className="text-sm text-muted-foreground font-[family-name:var(--font-mono)]">total</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-64">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70"
                style={{
                  width: `${completionPct}%`,
                  transformOrigin: "left",
                  animation: "bar-fill 0.8s ease-out both",
                  animationDelay: "300ms",
                }}
              />
            </div>
            <span className="text-sm font-bold text-primary tabular-nums font-[family-name:var(--font-mono)]">{completionPct}%</span>
          </div>
        </div>
      )}

      {/* Tab Navigation — hidden on page editor */}
      {!isPageEditor && (
        <nav className="flex items-center px-6 border-b border-border bg-muted/5">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              className={cn(
                "relative py-3.5 px-4 text-sm font-medium text-muted-foreground no-underline transition-colors duration-150 hover:text-foreground flex items-center gap-1.5",
                activeTab === tab.key && "text-primary font-semibold after:absolute after:bottom-[-1px] after:left-2 after:right-2 after:h-[3px] after:bg-primary after:rounded-full",
              )}
            >
              <tab.icon className={cn("size-4", activeTab === tab.key && "text-primary")} />
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <Badge variant="secondary" className="ml-1.5 font-[family-name:var(--font-mono)] text-xs px-1.5 tabular-nums bg-primary/10 text-primary">
                  {tab.count}
                </Badge>
              )}
            </Link>
          ))}
        </nav>
      )}

      {/* Child route content */}
      <div className="flex-1 min-h-0">
        <Outlet context={outletContext} />
      </div>

      {/* Dialogs */}
      <ModuleForm
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId!}
      />
      {showWin && (
        <AssignLeaderDialog
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
      {resolvedStatus === "active" && (
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
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                deleteProject.mutate(projectId!, {
                  onSuccess: () => {
                    client.cache.evict({ fieldName: "listProjects" });
                    client.cache.evict({ fieldName: "getProject" });
                    client.cache.gc();
                    coreClient.cache.evict({ fieldName: "listProjects" });
                    coreClient.cache.evict({ fieldName: "getProject" });
                    coreClient.cache.gc();
                    toast.success("Project deleted successfully");
                    navigate("/projects");
                  },
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
