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
import { LayoutList, LayoutGrid, Plus, Search } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { TaskForm } from "@/components/tasks/task-form";
import { useProject } from "@/hooks/use-projects";
import { useModule } from "@/hooks/use-modules";
import { NotificationBell } from "./notification-bell";

export function Header() {
  const { viewMode, setViewMode } = useUIStore();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const projectId = (params as { projectId?: string }).projectId;
  const moduleId = (params as { moduleId?: string }).moduleId;

  const { data: project } = useProject(projectId ?? "");
  const { data: module } = useModule(moduleId ?? "");

  const [searchValue, setSearchValue] = useState("");
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (projectId) {
      navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: (prev) => ({ ...prev, search: searchValue || undefined }),
      });
    }
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />

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
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                      >
                        {project?.coreDetail?.name.name}
                      </Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{project.coreDetail?.name.name}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </>
            )}
            {module && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{module.name}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>

        <form onSubmit={handleSearch} className="flex-1 max-w-sm ml-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              placeholder="Search tasks..."
              className="w-full rounded-full bg-muted/50 border-0 pl-9 pr-4 h-8 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30 focus:bg-muted transition-colors"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
        </form>

        <NotificationBell />

        <div className="flex items-center gap-2 ml-3">
          {moduleId && (
            <>
              <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
                <button
                  type="button"
                  className={`inline-flex items-center justify-center rounded-md px-2 h-7 text-xs transition-colors ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setViewMode("list")}
                >
                  <LayoutList className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center justify-center rounded-md px-2 h-7 text-xs transition-colors ${viewMode === "board" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setViewMode("board")}
                >
                  <LayoutGrid className="size-3.5" />
                </button>
              </div>
              <Button
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => setTaskFormOpen(true)}
              >
                <Plus className="size-4 mr-1" />
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
