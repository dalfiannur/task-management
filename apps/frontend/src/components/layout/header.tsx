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
import { Link, useParams, useSearchParams } from "react-router";
import { useState } from "react";
import { TaskForm } from "@/components/tasks/task-form";
import { useProject } from "@/hooks/use-projects";
import { useModule } from "@/hooks/use-modules";
import { NotificationBell } from "./notification-bell";
import { cn } from "@/lib/utils";
import styles from "./header.module.css";

export function Header() {
  const { viewMode, setViewMode } = useUIStore();
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

  return (
    <>
      <header className={styles.header}>
        <SidebarTrigger className={styles.triggerBtn} />
        <Separator orientation="vertical" className={styles.separatorEl} />

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

        <form onSubmit={handleSearch} className={styles.searchForm}>
          <div className={styles.searchWrapper}>
            <Search className={styles.searchIcon} />
            <input
              placeholder="Search tasks..."
              className={styles.searchInput}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
        </form>

        <NotificationBell />

        <div className={styles.actions}>
          {moduleId && (
            <>
              <div className={styles.viewToggle}>
                <button
                  type="button"
                  className={cn(styles.viewBtn, viewMode === "list" && styles.viewBtnActive)}
                  onClick={() => setViewMode("list")}
                >
                  <LayoutList className={styles.viewIcon} />
                </button>
                <button
                  type="button"
                  className={cn(styles.viewBtn, viewMode === "board" && styles.viewBtnActive)}
                  onClick={() => setViewMode("board")}
                >
                  <LayoutGrid className={styles.viewIcon} />
                </button>
              </div>
              <Button
                size="sm"
                className={styles.newTaskBtn}
                onClick={() => setTaskFormOpen(true)}
              >
                <Plus className={styles.newTaskIcon} />
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
