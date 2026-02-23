import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  FileText,
  ImageIcon,
  File,
  Plus,
  X,
} from "lucide-react";
import { useMediaFiles, useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: files = [] } = useMediaFiles({ projectId, taskId });
  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      await uploadMedia.mutateAsync({ file, projectId, taskId });
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
            className={styles.deleteButton}
            onClick={() => deleteMedia.mutate(file.id)}
          >
            <X className={styles.deleteIcon} />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className={styles.addButton}
        onClick={() => inputRef.current?.click()}
      >
        <Plus className={styles.addIcon} />
        Attach file
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileSelect}
      />
    </div>
  );
}
