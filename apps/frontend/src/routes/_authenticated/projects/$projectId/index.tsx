import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
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
import { Skeleton } from "@/components/ui/skeleton";
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
  CheckCircle2,
  Clock,
  CircleDot,
  FileText,
  FolderPlus,
  ArrowLeft,
  ChevronRight,
  Users,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WinProjectDialog } from "@/components/projects/win-project-dialog";
import { SubProjectForm } from "@/components/projects/sub-project-form";
import { ProjectMembersDialog } from "@/components/projects/project-members-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { useState } from "react";
import { PROJECT_STATUS_CONFIG } from "@/types/project";

const projectSearchSchema = z.object({
  status: z.string().optional().catch(undefined),
  priority: z.string().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/",
)({
  validateSearch: projectSearchSchema,
  component: ProjectDetailPage,
});

const STATUS_ACCENT: Record<string, { gradient: string; dot: string }> = {
  pending: {
    gradient: "from-gray-500/8 via-transparent",
    dot: "bg-gray-400",
  },
  prospect: {
    gradient: "from-amber-500/8 via-transparent",
    dot: "bg-amber-400",
  },
  win: {
    gradient: "from-emerald-500/8 via-transparent",
    dot: "bg-emerald-400",
  },
  on_going: {
    gradient: "from-blue-500/8 via-transparent",
    dot: "bg-blue-400",
  },
  canceled: {
    gradient: "from-red-500/8 via-transparent",
    dot: "bg-red-400",
  },
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const { status, priority, search } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: modules, isLoading: modulesLoading } = useModules(projectId);
  const { data: pic } = useUser(project?.picId?.value);
  const { data: allTasks } = useTasks();
  const { data: subProjects } = useSubProjects(projectId);
  const deleteProject = useDeleteProject();
  const [formOpen, setFormOpen] = useState(false);
  const [winDialogOpen, setWinDialogOpen] = useState(false);
  const [subProjectFormOpen, setSubProjectFormOpen] = useState(false);
  const [subProjectsExpanded, setSubProjectsExpanded] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);

  // if (projectLoading || modulesLoading) {
  //   return (
  //     <div className="p-6 space-y-6">
  //       <div className="space-y-3">
  //         <Skeleton className="h-5 w-32" />
  //         <Skeleton className="h-9 w-72" />
  //         <Skeleton className="h-4 w-48" />
  //       </div>
  //       <div className="grid grid-cols-3 gap-4">
  //         <Skeleton className="h-20" />
  //         <Skeleton className="h-20" />
  //         <Skeleton className="h-20" />
  //       </div>
  //       <div className="space-y-4">
  //         <Skeleton className="h-48 w-full" />
  //         <Skeleton className="h-48 w-full" />
  //       </div>
  //     </div>
  //   );
  // }

  if (!project) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Project not found
      </div>
    );
  }

  const statusConfig = PROJECT_STATUS_CONFIG[project.status.value];
  const accent = STATUS_ACCENT[project.status.value] ?? STATUS_ACCENT.pending;

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
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-0">
      {/* Hero Header */}
      <div
        className={`bg-gradient-to-br ${accent.gradient} to-transparent animate-[fade-up_0.4s_ease-out_both]`}
      >
        <div className="p-6 pb-5">
          {/* Top row: badges + actions */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="font-mono text-[11px] tracking-wider border-border/60"
              >
                {getProjectDisplayName(project)}
              </Badge>
              <Badge className={statusConfig.color + " border-0 text-[11px]"}>
                <span
                  className={`size-1.5 rounded-full ${accent.dot} mr-1.5 inline-block`}
                />
                {statusConfig.label}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5 mr-1.5" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the project &quot;{getProjectDisplayName(project)}&quot; and all its modules and tasks.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        deleteProject.mutate(projectId, {
                          onSuccess: () => navigate({ to: "/projects" }),
                        })
                      }
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                <Link
                  to="/projects/$projectId/timeline"
                  params={{ projectId }}
                >
                  <GanttChartIcon className="size-3.5 mr-1.5" />
                  Timeline
                </Link>
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                <Link
                  to="/projects/$projectId/pages"
                  params={{ projectId }}
                >
                  <FileText className="size-3.5 mr-1.5" />
                  Pages
                </Link>
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                <Link
                  to="/projects/$projectId/media"
                  params={{ projectId }}
                >
                  <ImageIcon className="size-3.5 mr-1.5" />
                  Media & Files
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setMembersOpen(true)}
              >
                <Users className="size-3.5 mr-1.5" />
                Members
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setSubProjectFormOpen(true)}
              >
                <FolderPlus className="size-3.5 mr-1.5" />
                Sub-Project
              </Button>
              {project.status.value === "win" && (
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setWinDialogOpen(true)}
                >
                  <Trophy className="size-3.5 mr-1.5" />
                  WIN
                </Button>
              )}
              {project.status.value === "on_going" && (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFormOpen(true)}
                >
                  <Plus className="size-3.5 mr-1.5" />
                  New Module
                </Button>
              )}
            </div>
          </div>

          {/* Title + PM + PIC */}
          {project.parent && (
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.parent.id }}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
            >
              <ArrowLeft className="size-3" />
              Back to parent project
            </Link>
          )}
          <h1 className="text-2xl font-bold font-display tracking-tight">
            {getProjectDisplayName(project)}
          </h1>
          <div className="flex items-center gap-4 mt-2">
            {pic && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">PIC</span>
                <Avatar className="size-5">
                  <AvatarImage src={pic.avatarUrl} />
                  <AvatarFallback className="text-[9px]">
                    {getInitials(pic.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground">
                  {pic.name}
                </span>
              </div>
            )}
            {project.description && (
              <div className="flex items-center text-sm text-muted-foreground/80">
                <span className="text-muted-foreground/40 mx-1">&middot;</span>
                <span
                  className="line-clamp-1"
                  dangerouslySetInnerHTML={{
                    __html: project.description.replace(/<[^>]*>/g, ""),
                  }}
                />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-5 ml-1 shrink-0">
                      <FileText className="size-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96">
                    <ScrollArea className="max-h-80">
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: project.description }}
                      />
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>

          {/* Quick Stats Strip */}
          {totalTasks > 0 && (
            <div
              className="flex items-center gap-6 mt-5 animate-[fade-up_0.4s_ease-out_both]"
              style={{ animationDelay: "100ms" }}
            >
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <span className="text-sm font-semibold font-display tabular-nums">
                    {doneTasks}
                  </span>
                  <span className="text-xs text-muted-foreground">done</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="size-3.5 text-amber-500" />
                  <span className="text-sm font-semibold font-display tabular-nums">
                    {inProgressTasks}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    in progress
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CircleDot className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-semibold font-display tabular-nums">
                    {totalTasks}
                  </span>
                  <span className="text-xs text-muted-foreground">total</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-2.5 flex-1 max-w-xs">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{
                      width: `${completionPct}%`,
                      transformOrigin: "left",
                      animation: "bar-fill 0.8s ease-out both",
                      animationDelay: "300ms",
                    }}
                  />
                </div>
                <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                  {completionPct}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-Projects */}
      {subProjects && subProjects.length > 0 && (
        <div className="px-6 py-4 border-b">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSubProjectsExpanded((v) => !v)}
          >
            <ChevronRight
              className={`size-4 transition-transform ${subProjectsExpanded ? "rotate-90" : ""}`}
            />
            Sub-Projects
            <span className="text-xs text-muted-foreground/60">
              ({subProjects.length})
            </span>
          </button>
          {subProjectsExpanded && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3">
              {subProjects.map((sub) => (
                <ProjectCard key={sub.id} project={sub} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters Row */}
      <div
        className="px-6 py-3 border-b flex items-center gap-3 animate-[fade-up_0.4s_ease-out_both]"
        style={{ animationDelay: "150ms" }}
      >
        <TaskFilters filters={{ status, priority }} />
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            placeholder="Search tasks..."
            value={search ?? ""}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  search: e.target.value || undefined,
                }),
              })
            }
            className="rounded-full bg-muted/50 border-0 pl-9 pr-4 h-8 text-sm w-[220px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30 focus:bg-muted transition-colors"
          />
        </div>
      </div>

      {/* Module List */}
      <div className="p-6 space-y-4">
        {modules?.map((mod, index) => (
          <div
            key={mod.id}
            className="animate-[fade-up_0.4s_ease-out_both]"
            style={{ animationDelay: `${index * 75 + 200}ms` }}
          >
            <ModuleSection
              module={mod}
              projectId={projectId}
              colorIndex={index}
              filters={{ status, priority, search }}
              projectStatus={project.status.value}
            />
          </div>
        ))}
      </div>
      {modules?.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <CircleDot className="size-8 text-muted-foreground/30" />
          <div className="text-center">
            <p className="font-medium">No modules yet</p>
            <p className="text-sm text-muted-foreground/70 mt-0.5">
              Create a module to start organizing tasks.
            </p>
          </div>
          {project.status.value === "on_going" && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setFormOpen(true)}
            >
              <Plus className="size-3.5 mr-1.5" />
              Create Module
            </Button>
          )}
        </div>
      )}
      <ModuleForm
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
      />
      {project.status.value === "win" && (
        <WinProjectDialog
          project={project}
          open={winDialogOpen}
          onOpenChange={setWinDialogOpen}
        />
      )}
      <SubProjectForm
        open={subProjectFormOpen}
        onOpenChange={setSubProjectFormOpen}
        parentProjectId={projectId}
      />
      <ProjectMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        projectId={projectId}
        picId={project?.picId?.value}
      />
    </div>
  );
}
