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
import { LayoutList, LayoutGrid, Plus, Search, Sun, Moon } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { Link, useParams, useSearchParams } from "react-router";
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
  const [, setSearchParams] = useSearchParams();
  const params = useParams();
  const projectId = (params as { projectId?: string }).projectId;
  const moduleId = (params as { moduleId?: string }).moduleId;

  const { data: project } = useProject(projectId ?? "");
  const { data: module } = useModule(moduleId ?? "");

  const [searchValue, setSearchValue] = useState("");
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (projectId) {
      setSearchParams((prev) => {
        if (searchValue) {
          prev.set("search", searchValue);
        } else {
          prev.delete("search");
        }
        return prev;
      });
    }
  };

  const projectName = project ? getProjectDisplayName(project) : undefined;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-border px-5 py-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1.5 h-5" />
        <CompanySelector />

        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/projects">Projects</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
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

        <form onSubmit={handleSearch} className="ml-auto flex-1 max-w-[28rem]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-[0.8125rem] text-muted-foreground" />
            <input
              placeholder="Search tasks..."
              className="w-full rounded-lg bg-muted/40 ring-1 ring-border pl-9 pr-4 h-9 text-sm transition-all placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-background"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
        </form>

        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="size-8 shrink-0"
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
