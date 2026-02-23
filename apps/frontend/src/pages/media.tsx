import { useParams, useSearchParams } from "react-router";
import { useState } from "react";
import { useMediaFiles } from "@/hooks/use-media";
import { useUIStore } from "@/stores/ui-store";
import { MediaHeader } from "@/components/media/media-header";
import { MediaGrid } from "@/components/media/media-grid";
import { MediaTable } from "@/components/media/media-table";
import { MediaUploadDialog } from "@/components/media/media-upload-dialog";
import styles from "./media.module.css";

export function Component() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") ?? undefined;
  const taskId = searchParams.get("taskId") ?? undefined;
  const { mediaViewMode } = useUIStore();
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: files = [], isLoading } = useMediaFiles({
    projectId: projectId!,
    taskId,
    mimeType: type,
  });

  return (
    <div className={styles.page}>
      <MediaHeader
        projectId={projectId!}
        onUploadClick={() => setUploadOpen(true)}
      />

      {mediaViewMode === "grid" ? (
        <MediaGrid files={files} isLoading={isLoading} />
      ) : (
        <MediaTable files={files} isLoading={isLoading} />
      )}

      <MediaUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={projectId!}
      />
    </div>
  );
}
