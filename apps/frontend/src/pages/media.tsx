import { useState, useCallback } from "react";
import { useParams } from "react-router";
import { useProject, useSubProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { useResolveMediaProjectId } from "@/hooks/use-media-project";
import { useModule } from "@/hooks/use-modules";
import { useTask } from "@/hooks/use-tasks";
import { useFileManager } from "@/hooks/use-file-manager";
import { FileManagerSidebar } from "@/components/media/file-manager-sidebar";
import { FileManagerToolbar } from "@/components/media/file-manager-toolbar";
import { FileManagerBreadcrumb } from "@/components/media/file-manager-breadcrumb";
import { FileManagerContent } from "@/components/media/file-manager-content";
import { MediaUploadDialog } from "@/components/media/media-upload-dialog";
import type { Project } from "@/types/project";
import styles from "./media.module.css";

export function Component() {
  const { projectId } = useParams();
  const fm = useFileManager();

  // Active project — either the route project or a sub-project selected in sidebar
  const [activeProjectId, setActiveProjectId] = useState(projectId!);

  const { data: project } = useProject(projectId!);
  const { data: activeProject } = useProject(activeProjectId);
  const isSubProject = !!project?.parent;

  const { data: subProjects = [] } = useSubProjects(
    isSubProject ? undefined : projectId,
  );

  // Resolve media project ID for active project
  const { mediaProjectId } = useResolveMediaProjectId(
    activeProject?.coreRef?.value,
    activeProject ? getProjectDisplayName(activeProject) : "Project",
  );

  // Look up names for breadcrumb
  const { data: selectedModule } = useModule(fm.selectedModuleId ?? "");
  const { data: selectedTask } = useTask(fm.selectedTaskId ?? "");

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);

  const handleUploadClick = useCallback(() => {
    setUploadOpen(true);
  }, []);

  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSelectProject = useCallback(
    (id: string) => {
      setActiveProjectId(id);
      fm.navigateToProject();
    },
    [fm],
  );

  if (!project) return null;

  const projectName = activeProject
    ? getProjectDisplayName(activeProject)
    : "Project";

  return (
    <div className={styles.layout}>
      <FileManagerSidebar
        project={project}
        subProjects={subProjects as Project[]}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
      />

      <div className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>Files</h1>
        </div>

        <FileManagerBreadcrumb
          projectName={projectName}
          moduleName={selectedModule?.name}
          taskTitle={selectedTask?.title}
          fm={fm}
        />

        <FileManagerToolbar
          fm={fm}
          onUploadClick={handleUploadClick}
          onRefresh={handleRefresh}
          showUpButton={!!fm.selectedModuleId || !!fm.selectedTaskId}
        />

        <FileManagerContent
          projectId={activeProjectId}
          mediaProjectId={mediaProjectId ?? undefined}
          fm={fm}
        />
      </div>

      <MediaUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={activeProjectId}
        mediaProjectId={mediaProjectId ?? undefined}
        taskId={fm.selectedTaskId ?? undefined}
      />
    </div>
  );
}
