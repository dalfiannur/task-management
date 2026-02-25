import { useParams, useSearchParams } from "react-router";
import { useState } from "react";
import { useProject, useSubProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { MediaHeader } from "@/components/media/media-header";
import { MediaSection } from "@/components/media/media-section";
import { MediaUploadDialog } from "@/components/media/media-upload-dialog";
import styles from "./media.module.css";

export function Component() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") ?? undefined;
  const taskId = searchParams.get("taskId") ?? undefined;

  const { data: project } = useProject(projectId!);
  const isSubProject = !!project?.parent;
  const parentId = project?.parent?.id;

  const { data: parentProject } = useProject(parentId ?? "");
  const { data: subProjects } = useSubProjects(isSubProject ? undefined : projectId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState(projectId!);

  function handleUploadClick(targetProjectId: string) {
    setUploadProjectId(targetProjectId);
    setUploadOpen(true);
  }

  return (
    <div className={styles.page}>
      <MediaHeader />

      {/* Current project media */}
      <MediaSection
        projectId={projectId!}
        projectName={project ? getProjectDisplayName(project) : "Current Project"}
        defaultOpen
        taskId={taskId}
        mimeType={type}
        onUploadClick={() => handleUploadClick(projectId!)}
      />

      {/* Sub-project viewing parent: read-only parent section */}
      {isSubProject && parentProject && (
        <MediaSection
          projectId={parentProject.id}
          projectName={getProjectDisplayName(parentProject)}
          readOnly
        />
      )}

      {/* Core project viewing sub-projects: full-access sections */}
      {!isSubProject &&
        subProjects?.map((sub) => (
          <MediaSection
            key={sub.id}
            projectId={sub.id}
            projectName={getProjectDisplayName(sub)}
            onUploadClick={() => handleUploadClick(sub.id)}
          />
        ))}

      <MediaUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={uploadProjectId}
      />
    </div>
  );
}
