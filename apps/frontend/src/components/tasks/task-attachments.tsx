import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  FileText,
  ImageIcon,
  File,
  Plus,
  X,
  Download,
} from "lucide-react";
import { useTaskMediaFiles, useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
import { useProject, getProjectDisplayName } from "@/hooks/use-projects";
import { useResolveMediaProjectId } from "@/hooks/use-media-project";
import { isImage, formatFileSize } from "@/types/media";
import styles from "./task-attachments.module.css";

interface TaskAttachmentsProps {
  projectId: string;
  taskId: string;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className={`${styles.fileIcon} ${styles.iconPurple}`} />;
  if (mimeType === "application/pdf")
    return <FileText className={`${styles.fileIcon} ${styles.iconRed}`} />;
  return <File className={`${styles.fileIcon} ${styles.iconMuted}`} />;
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
    for (const file of Array.from(fileList)) {
      await uploadMedia.mutateAsync({ file, mediaProjectId: mediaProjectId ?? "", projectId, taskId });
    }
    e.target.value = "";
  };

  return (
    <div className={styles.container}>
      {files.map((file) => (
        <div
          key={file.id}
          className={styles.fileRow}
        >
          <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
          <span className={styles.fileName} title={file.mediaFileInfo.originalFileName}>
            {file.mediaFileInfo.originalFileName}
          </span>
          <span className={styles.fileSize}>
            {formatFileSize(file.mediaFileInfo.size)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className={styles.actionButton}
            asChild
          >
            <a
              href={file.mediaFileInfo.url}
              download={file.mediaFileInfo.originalFileName}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className={styles.actionIcon} />
            </a>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={styles.actionButton}
            onClick={() => deleteMedia.mutate(file.id)}
          >
            <X className={styles.actionIcon} />
          </Button>
        </div>
      ))}
      <label htmlFor={inputId} className={styles.addLabel}>
        <Plus className={styles.addIcon} />
        Attach file
        <input
          id={inputId}
          type="file"
          multiple
          className={styles.hiddenInput}
          onChange={handleFileSelect}
        />
      </label>
    </div>
  );
}
