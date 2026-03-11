import { useMemo } from "react";
import { useModules } from "@/hooks/use-modules";
import { useTasks, useAllTasks } from "@/hooks/use-tasks";
import { useMediaFiles, useTaskMediaFiles } from "@/hooks/use-media";
import { useUIStore } from "@/stores/ui-store";
import { FolderGrid } from "./folder-grid";
import { MediaGrid } from "./media-grid";
import { MediaTable } from "./media-table";
import type { FileManagerState } from "@/hooks/use-file-manager";
import type { MediaFile } from "@/types/media";
import styles from "./file-manager-content.module.css";

interface FileManagerContentProps {
  projectId: string;
  mediaProjectId?: string;
  fm: FileManagerState;
  sharedFiles?: MediaFile[];
  sharedFilesLoading?: boolean;
  showShared?: boolean;
  visibilityMap?: Map<string, "private" | "shared">;
}

export function FileManagerContent({
  projectId,
  mediaProjectId,
  fm,
  sharedFiles = [],
  sharedFilesLoading,
  showShared,
  visibilityMap,
}: FileManagerContentProps) {
  const { mediaViewMode } = useUIStore();

  // Fetch all modules for the project
  const { data: modules = [], isLoading: modulesLoading } = useModules(projectId);

  // Fetch all tasks for the project (to map taskId → moduleId)
  const { data: allTasks = [] } = useAllTasks({ projectId });

  // Fetch tasks for selected module
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(
    fm.selectedModuleId ? { moduleId: fm.selectedModuleId } : {},
  );

  // Fetch all project files (used for flatten + to determine which modules/tasks have files)
  const { data: allFiles = [], isLoading: allFilesLoading } = useMediaFiles({
    projectId,
    mediaProjectId,
  });

  // Fetch files for selected task
  const { data: taskFiles = [], isLoading: taskFilesLoading } =
    useTaskMediaFiles(fm.selectedTaskId ?? "", mediaProjectId);

  // Build sets of taskIds and moduleIds that have files
  const { taskIdsWithFiles, moduleIdsWithFiles, fileCountByTask, fileCountByModule } =
    useMemo(() => {
      const taskIds = new Set<string>();
      const fileCounts = new Map<string, number>();

      for (const file of allFiles) {
        const tid = file.mediaFileInfo.taskId;
        if (tid) {
          taskIds.add(tid);
          fileCounts.set(tid, (fileCounts.get(tid) ?? 0) + 1);
        }
      }

      // Map taskIds → moduleIds
      const moduleIds = new Set<string>();
      const moduleCounts = new Map<string, number>();
      for (const task of allTasks) {
        if (taskIds.has(task.id) && task.moduleId) {
          moduleIds.add(task.moduleId);
          const count = fileCounts.get(task.id) ?? 0;
          moduleCounts.set(task.moduleId, (moduleCounts.get(task.moduleId) ?? 0) + count);
        }
      }

      return {
        taskIdsWithFiles: taskIds,
        moduleIdsWithFiles: moduleIds,
        fileCountByTask: fileCounts,
        fileCountByModule: moduleCounts,
      };
    }, [allFiles, allTasks]);

  // Search filter
  const query = fm.searchQuery.toLowerCase().trim();

  // Only modules that have files (via tasks)
  const moduleFolders = useMemo(() => {
    let items = modules
      .filter((m) => moduleIdsWithFiles.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        subtitle: pluralize(fileCountByModule.get(m.id) ?? 0, "file"),
      }));
    if (query) {
      items = items.filter((i) => i.name.toLowerCase().includes(query));
    }
    return items;
  }, [modules, moduleIdsWithFiles, fileCountByModule, query]);

  // Only tasks that have files
  const taskFolders = useMemo(() => {
    let items = tasks
      .filter((t) => taskIdsWithFiles.has(t.id))
      .map((t) => ({
        id: t.id,
        name: t.title,
        subtitle: pluralize(fileCountByTask.get(t.id) ?? 0, "file"),
      }));
    if (query) {
      items = items.filter((i) => i.name.toLowerCase().includes(query));
    }
    return items;
  }, [tasks, taskIdsWithFiles, fileCountByTask, query]);

  // --- Task level: show task files ---
  if (fm.selectedTaskId) {
    const filtered = filterFiles(taskFiles, query);
    const sorted = sortFiles(filtered, fm.sortBy, fm.sortDir);

    return (
      <div className={styles.content}>
        {mediaViewMode === "grid" ? (
          <MediaGrid files={sorted} isLoading={taskFilesLoading} projectId={projectId} visibilityMap={visibilityMap} />
        ) : (
          <MediaTable files={sorted} isLoading={taskFilesLoading} projectId={projectId} visibilityMap={visibilityMap} />
        )}
      </div>
    );
  }

  // --- Module level: show tasks with files ---
  if (fm.selectedModuleId) {
    return (
      <div className={styles.content}>
        <FolderGrid
          items={taskFolders}
          isLoading={tasksLoading}
          onOpen={fm.navigateToTask}
          emptyMessage="No files in this module"
        />
      </div>
    );
  }

  // --- Project level: show module folders + unlinked files ---
  const unlinkedFiles = useMemo(() => {
    const files = allFiles.filter((f) => !f.mediaFileInfo.taskId);
    return sortFiles(filterFiles(files, query), fm.sortBy, fm.sortDir);
  }, [allFiles, query, fm.sortBy, fm.sortDir]);

  const filteredSharedProject = showShared ? filterFiles(sharedFiles, query) : [];
  const sortedSharedProject = sortFiles(filteredSharedProject, fm.sortBy, fm.sortDir);

  const hasSharedToShow = showShared && sortedSharedProject.length > 0;
  const hasContent = moduleFolders.length > 0 || unlinkedFiles.length > 0 || hasSharedToShow;

  return (
    <div className={styles.content}>
      {moduleFolders.length > 0 && (
        <FolderGrid
          items={moduleFolders}
          isLoading={modulesLoading || allFilesLoading}
          onOpen={fm.navigateToModule}
        />
      )}
      {unlinkedFiles.length > 0 && (
        <>
          {moduleFolders.length > 0 && (
            <div className={styles.sharedDivider}>
              <span className={styles.sharedDividerText}>Project Files</span>
            </div>
          )}
          {mediaViewMode === "grid" ? (
            <MediaGrid files={unlinkedFiles} isLoading={allFilesLoading} projectId={projectId} visibilityMap={visibilityMap} />
          ) : (
            <MediaTable files={unlinkedFiles} isLoading={allFilesLoading} projectId={projectId} visibilityMap={visibilityMap} />
          )}
        </>
      )}
      {hasSharedToShow && (
        <>
          <div className={styles.sharedDivider}>
            <span className={styles.sharedDividerText}>Shared Files</span>
          </div>
          {mediaViewMode === "grid" ? (
            <MediaGrid files={sortedSharedProject} isLoading={sharedFilesLoading ?? false} readOnly />
          ) : (
            <MediaTable files={sortedSharedProject} isLoading={sharedFilesLoading ?? false} readOnly />
          )}
        </>
      )}
      {!hasContent && !allFilesLoading && !modulesLoading && (
        <FolderGrid
          items={[]}
          isLoading={false}
          onOpen={() => {}}
          emptyMessage="No files in this project"
        />
      )}
    </div>
  );
}

// --- Helpers ---

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count !== 1 ? "s" : ""}`;
}

function filterFiles(files: MediaFile[], query: string): MediaFile[] {
  if (!query) return files;
  return files.filter((f) =>
    f.mediaFileInfo.originalFileName.toLowerCase().includes(query),
  );
}

function sortFiles(
  files: MediaFile[],
  sortBy: string,
  sortDir: string,
): MediaFile[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return (
          dir *
          a.mediaFileInfo.originalFileName.localeCompare(
            b.mediaFileInfo.originalFileName,
          )
        );
      case "size":
        return dir * (a.mediaFileInfo.size - b.mediaFileInfo.size);
      case "type":
        return (
          dir *
          a.mediaFileInfo.mimeType.localeCompare(b.mediaFileInfo.mimeType)
        );
      case "date":
        return (
          dir *
          a.mediaFileInfo.originalFileName.localeCompare(
            b.mediaFileInfo.originalFileName,
          )
        );
      default:
        return 0;
    }
  });
}
