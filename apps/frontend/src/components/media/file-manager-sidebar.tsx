import { cn } from "@/lib/utils";
import { FolderOpen, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CoreProject } from "@/types/project";
import { getProjectDisplayName } from "@/hooks/use-projects";
import styles from "./file-manager-sidebar.module.css";

interface FileManagerSidebarProps {
  project: CoreProject;
  subProjects: CoreProject[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
}

export function FileManagerSidebar({
  project,
  subProjects,
  activeProjectId,
  onSelectProject,
}: FileManagerSidebarProps) {
  const isSubProject = !!project.ref?.parentId;
  const allProjects = isSubProject
    ? [project]
    : [project, ...subProjects];

  return (
    <nav className={styles.sidebar}>
      <div className={styles.header}>Projects</div>
      <ul className={styles.tree}>
        {allProjects.map((p) => (
          <li key={p.id}>
            <Button
              variant="ghost"
              type="button"
              className={cn(
                styles.treeItem,
                activeProjectId === p.id && styles.active,
              )}
              onClick={() => onSelectProject(p.id)}
            >
              {activeProjectId === p.id ? (
                <FolderOpen className={styles.folderIcon} />
              ) : (
                <Folder className={styles.folderIcon} />
              )}
              <span className={styles.itemName}>
                {getProjectDisplayName(p)}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
