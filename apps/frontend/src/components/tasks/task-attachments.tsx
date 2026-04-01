import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  FileText,
  ImageIcon,
  File,
  Paperclip,
  Plus,
  X,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useTaskMediaFiles, useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
import { useProject, getProjectDisplayName } from "@/hooks/use-projects";
import { useResolveMediaProjectId } from "@/hooks/use-media-project";
import { isImage, formatFileSize } from "@/types/media";

interface TaskAttachmentsProps {
  projectId: string;
  taskId: string;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType))
    return <ImageIcon className="size-4 text-purple-500" />;
  if (mimeType === "application/pdf")
    return <FileText className="size-4 text-red-500" />;
  return <File className="size-4 text-muted-foreground" />;
}

export function TaskAttachments({ projectId, taskId }: TaskAttachmentsProps) {
  const inputId = useId();
  const { data: project } = useProject(projectId);
  const { mediaProjectId } = useResolveMediaProjectId(
    project?.id,
    project ? getProjectDisplayName(project) : "Project",
  );
  const { data: files = [] } = useTaskMediaFiles(taskId, mediaProjectId ?? undefined);
  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    if (!mediaProjectId) {
      toast.error("Unable to upload files: project not found");
      e.target.value = "";
      return;
    }
    for (const file of Array.from(fileList)) {
      try {
        await uploadMedia.mutateAsync({ file, mediaProjectId, projectId, taskId });
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Paperclip className="size-4" />
          <span className="text-sm font-medium">Files</span>
        </div>
        <label
          htmlFor={inputId}
          className={
            mediaProjectId
              ? "inline-flex items-center gap-1 text-xs font-medium text-primary cursor-pointer hover:text-primary/80 transition-colors"
              : "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground cursor-not-allowed"
          }
        >
          <Plus className="size-3" />
          Attach
          <input
            id={inputId}
            type="file"
            multiple
            className="hidden"
            disabled={!mediaProjectId}
            onChange={handleFileSelect}
          />
        </label>
      </div>

      {/* File cards */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-background border border-border shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex items-center justify-center size-8 rounded-lg bg-slate-800/50 shrink-0">
                <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" title={file.mediaFileInfo.originalFileName}>
                  {file.mediaFileInfo.originalFileName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatFileSize(file.mediaFileInfo.size)}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-5 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
                asChild
              >
                <a
                  href={file.mediaFileInfo.url}
                  download={file.mediaFileInfo.originalFileName}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-3" />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-5 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
                disabled={deleteMedia.isLoading}
                onClick={() => deleteMedia.mutate(file.id)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
