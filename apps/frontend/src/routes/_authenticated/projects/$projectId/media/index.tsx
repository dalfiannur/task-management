import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { useMediaFiles } from "@/hooks/use-media";
import { useUIStore } from "@/stores/ui-store";
import { MediaHeader } from "@/components/media/media-header";
import { MediaGrid } from "@/components/media/media-grid";
import { MediaTable } from "@/components/media/media-table";
import { MediaUploadDialog } from "@/components/media/media-upload-dialog";

const searchSchema = z.object({
  type: z.string().optional().catch(undefined),
  taskId: z.string().optional().catch(undefined),
  page: z.number().optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/media/",
)({
  validateSearch: searchSchema,
  component: MediaPage,
});

function MediaPage() {
  const { projectId } = Route.useParams();
  const { type, taskId } = Route.useSearch();
  const { mediaViewMode } = useUIStore();
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: files = [], isLoading } = useMediaFiles({
    projectId,
    taskId,
    mimeType: type,
  });

  return (
    <div className="p-6 space-y-4">
      <MediaHeader projectId={projectId} onUploadClick={() => setUploadOpen(true)} />

      {mediaViewMode === "grid" ? (
        <MediaGrid files={files} isLoading={isLoading} />
      ) : (
        <MediaTable files={files} isLoading={isLoading} />
      )}

      <MediaUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={projectId}
      />
    </div>
  );
}
