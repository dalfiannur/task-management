import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useCloseProject } from "@/hooks/use-projects";
import { useMediaFiles, useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
import { isImage, formatFileSize } from "@/types/media";
import type { Project } from "@/types/project";
import { FileText, ImageIcon, File, Plus, X } from "lucide-react";
import styles from "./close-project-dialog.module.css";

interface CloseProjectDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className={styles.attachmentIconPurple} />;
  if (mimeType === "application/pdf")
    return <FileText className={styles.attachmentIconRed} />;
  return <File className={styles.attachmentIconDefault} />;
}

export function CloseProjectDialog({
  project,
  open,
  onOpenChange,
}: CloseProjectDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeProject = useCloseProject();

  const { data: files = [] } = useMediaFiles({ projectId: project.id });
  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      await uploadMedia.mutateAsync({ file, projectId: project.id });
    }
    e.target.value = "";
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    closeProject.mutate(
      { id: project.id },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Close Project</DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <p className={styles.warningText}>
              This will permanently close the project. Closed projects cannot be
              reopened, and no new modules or tasks can be created.
            </p>
            <div className={styles.field}>
              <Label>Report Files</Label>
              {files.map((file) => (
                <div key={file.id} className={styles.attachmentRow}>
                  <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
                  <span
                    className={styles.fileName}
                    title={file.mediaFileInfo.originalFileName}
                  >
                    {file.mediaFileInfo.originalFileName}
                  </span>
                  <span className={styles.fileSize}>
                    {formatFileSize(file.mediaFileInfo.size)}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={styles.removeButton}
                    onClick={() => deleteMedia.mutate(file.id)}
                  >
                    <X className={styles.removeIcon} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={styles.attachButton}
                onClick={() => inputRef.current?.click()}
              >
                <Plus className={styles.attachIcon} />
                Attach report file
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className={styles.hiddenInput}
                onChange={handleFileSelect}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={styles.closeButton}
              disabled={closeProject.isLoading}
            >
              {closeProject.isLoading ? "Closing..." : "Close Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
