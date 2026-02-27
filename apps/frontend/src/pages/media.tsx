import { useParams, useSearchParams } from "react-router";
import { useState } from "react";
import { useProject, useSubProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { useResolveMediaProjectId } from "@/hooks/use-media-project";
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

  // Resolve sedjiwa-media project ID from coreProjectId
  const { mediaProjectId } = useResolveMediaProjectId(
    project?.coreRef?.value,
    project ? getProjectDisplayName(project) : "Project",
  );

  const { mediaProjectId: parentMediaProjectId } = useResolveMediaProjectId(
    parentProject?.coreRef?.value,
    parentProject ? getProjectDisplayName(parentProject) : "Parent Project",
  );

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState(projectId!);
  const [uploadMediaProjectId, setUploadMediaProjectId] = useState<string | null>(null);

  function handleUploadClick(targetProjectId: string, targetMediaProjectId?: string | null) {
    setUploadProjectId(targetProjectId);
    setUploadMediaProjectId(targetMediaProjectId ?? null);
    setUploadOpen(true);
  }

  return (
    <div className={styles.page}>
      <MediaHeader />

      {/* Current project media */}
      <MediaSection
        projectId={projectId!}
        mediaProjectId={mediaProjectId ?? undefined}
        projectName={project ? getProjectDisplayName(project) : "Current Project"}
        defaultOpen
        taskId={taskId}
        mimeType={type}
        onUploadClick={() => handleUploadClick(projectId!, mediaProjectId)}
      />

      {/* Sub-project viewing parent: read-only parent section */}
      {isSubProject && parentProject && (
        <MediaSection
          projectId={parentProject.id}
          mediaProjectId={parentMediaProjectId ?? undefined}
          projectName={getProjectDisplayName(parentProject)}
          readOnly
        />
      )}

      {/* Core project viewing sub-projects: full-access sections */}
      {!isSubProject &&
        subProjects?.map((sub) => (
          <SubProjectMediaSection
            key={sub.id}
            sub={sub}
            onUploadClick={handleUploadClick}
          />
        ))}

      <MediaUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={uploadProjectId}
        mediaProjectId={uploadMediaProjectId ?? undefined}
      />
    </div>
  );
}

/** Wrapper that resolves mediaProjectId for each sub-project */
function SubProjectMediaSection({
  sub,
  onUploadClick,
}: {
  sub: { id: string; coreRef?: { value: string }; name?: { value: string }; coreName?: string };
  onUploadClick: (projectId: string, mediaProjectId?: string | null) => void;
}) {
  const displayName = sub.name?.value || sub.coreName || "Untitled";
  const { mediaProjectId } = useResolveMediaProjectId(
    sub.coreRef?.value,
    displayName,
  );

  return (
    <MediaSection
      projectId={sub.id}
      mediaProjectId={mediaProjectId ?? undefined}
      projectName={displayName}
      onUploadClick={() => onUploadClick(sub.id, mediaProjectId)}
    />
  );
}
