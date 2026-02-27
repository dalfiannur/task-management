import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { FileManagerState } from "@/hooks/use-file-manager";
import styles from "./file-manager-breadcrumb.module.css";

interface FileManagerBreadcrumbProps {
  projectName: string;
  moduleName?: string;
  taskTitle?: string;
  fm: FileManagerState;
}

export function FileManagerBreadcrumb({
  projectName,
  moduleName,
  taskTitle,
  fm,
}: FileManagerBreadcrumbProps) {
  const isAtProject = !fm.selectedModuleId && !fm.selectedTaskId;
  const isAtModule = !!fm.selectedModuleId && !fm.selectedTaskId;

  return (
    <div className={styles.wrapper}>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {isAtProject && !fm.flatten ? (
              <BreadcrumbPage>{projectName}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  fm.navigateToProject();
                }}
              >
                {projectName}
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>

          {fm.flatten && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>All Files</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}

          {!fm.flatten && moduleName && fm.selectedModuleId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isAtModule ? (
                  <BreadcrumbPage>{moduleName}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      fm.navigateToModule(fm.selectedModuleId!);
                    }}
                  >
                    {moduleName}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </>
          )}

          {!fm.flatten && taskTitle && fm.selectedTaskId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{taskTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
