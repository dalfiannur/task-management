import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { LayoutList, LayoutGrid, Plus, Sun, Moon } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { Link, useParams } from "react-router";
import { useState } from "react";
import { useTheme } from "next-themes";
import { TaskForm } from "@/components/tasks/task-form";
import { useProject, getProjectDisplayName } from "@/hooks/use-projects";
import { useModule } from "@/hooks/use-modules";
import { NotificationBell } from "./notification-bell";
import { CompanySelector } from "./company-selector";
import { cn } from "@/lib/utils";

export function Header() {
  const { viewMode, setViewMode } = useUIStore();
  const { theme, setTheme } = useTheme();
  const params = useParams();
  const projectId = (params as { projectId?: string }).projectId;
  const moduleId = (params as { moduleId?: string }).moduleId;

  const { data: project } = useProject(projectId ?? "");
  const { data: module } = useModule(moduleId ?? "");

  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const projectName = project ? getProjectDisplayName(project) : undefined;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-border px-5 py-2">
        <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
        <Separator orientation="vertical" className="mr-1.5 h-5" />
        <CompanySelector />

        <Breadcrumb>
          <BreadcrumbList>
            {project && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {moduleId ? (
                    <BreadcrumbLink asChild>
                      <Link to={`/projects/${project.id}`}>
                        {projectName}
                      </Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="text-primary font-semibold">{projectName}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </>
            )}
            {module && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-primary font-semibold">{module.name}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex-1 max-w-[28rem]"/>

        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        <NotificationBell />

        <div className="flex items-center gap-2 ml-3 pl-3 border-l border-border">
          {moduleId && (
            <>
              <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center justify-center rounded-[calc(var(--radius)-2px)] px-2.5 h-7 text-sm transition-colors text-muted-foreground hover:text-foreground",
                    viewMode === "list" && "bg-primary text-primary-foreground shadow-sm",
                  )}
                  onClick={() => setViewMode("list")}
                >
                  <LayoutList className="size-[0.8125rem]" />
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center justify-center rounded-[calc(var(--radius)-2px)] px-2.5 h-7 text-sm transition-colors text-muted-foreground hover:text-foreground",
                    viewMode === "board" && "bg-primary text-primary-foreground shadow-sm",
                  )}
                  onClick={() => setViewMode("board")}
                >
                  <LayoutGrid className="size-[0.8125rem]" />
                </button>
              </div>
              <Button
                size="sm"
                className="h-9 px-4 rounded-lg shadow-sm"
                onClick={() => setTaskFormOpen(true)}
              >
                <Plus className="size-3.5 mr-1" />
                New Task
              </Button>
            </>
          )}
        </div>
      </header>
      {moduleId && (
        <TaskForm
          open={taskFormOpen}
          onOpenChange={setTaskFormOpen}
          moduleId={moduleId}
          projectId={projectId}
        />
      )}
    </>
  );
}
