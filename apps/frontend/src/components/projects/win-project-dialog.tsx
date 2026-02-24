import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { UserCombobox } from "@/components/shared/user-combobox";
import { useUpdateProject } from "@/hooks/use-projects";
import { useMediaFiles, useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
import { isImage, formatFileSize } from "@/types/media";
import type { Project } from "@/types/project";
import { FileText, ImageIcon, File, Plus, X } from "lucide-react";
import styles from "./win-project-dialog.module.css";

interface WinProjectDialogProps {
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

export function WinProjectDialog({
  project,
  open,
  onOpenChange,
}: WinProjectDialogProps) {
  const [projectLeaderId, setProjectLeaderId] = useState<string | undefined>(project.projectLeaderId?.value);
  const [description, setDescription] = useState(project.description ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const updateProject = useUpdateProject();

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
    updateProject.mutate(
      {
        id: project.id,
        description,
        projectLeaderId,
        status: "on_going",
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Win Project — {project.coreName}</DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <Label>Project Leader</Label>
              <UserCombobox value={projectLeaderId} onChange={setProjectLeaderId} />
            </div>
            <div className={styles.field}>
              <Label>Description / Brief</Label>
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder="Enter project brief..."
              />
            </div>
            <div className={styles.field}>
              <Label>Attachments</Label>
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
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateProject.isLoading}>
              {updateProject.isLoading ? "Saving..." : "Save & Start Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
