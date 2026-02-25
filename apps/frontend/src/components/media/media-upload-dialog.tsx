import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, X, File as FileIcon } from "lucide-react";
import { formatFileSize } from "@/types/media";
import { useUploadMedia } from "@/hooks/use-media";
import { cn } from "@/lib/utils";
import styles from "./media-upload-dialog.module.css";

interface MediaUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  taskId?: string;
}

export function MediaUploadDialog({
  open,
  onOpenChange,
  projectId,
  taskId,
}: MediaUploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMedia = useUploadMedia();

  const addFiles = useCallback((files: FileList | File[]) => {
    setSelectedFiles((prev) => [...prev, ...Array.from(files)]);
  }, []);

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    try {
      for (const file of selectedFiles) {
        await uploadMedia.mutateAsync({ file, projectId, taskId });
      }
      setSelectedFiles([]);
      onOpenChange(false);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            Select files to upload to this project.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(styles.dropzone, dragOver && styles.dropzoneActive)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className={styles.dropzoneIcon} />
          <p className={styles.dropzoneText}>
            Drag & drop files here, or
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Browse Files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className={styles.hiddenInput}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {selectedFiles.length > 0 && (
          <div className={styles.fileList}>
            {selectedFiles.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className={styles.fileItem}
              >
                <FileIcon className={styles.fileItemIcon} />
                <span className={styles.fileItemName}>{file.name}</span>
                <span className={styles.fileItemSize}>
                  {formatFileSize(file.size)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className={styles.removeBtn}
                  onClick={() => removeFile(i)}
                >
                  <X className={styles.removeIcon} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.footer}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={selectedFiles.length === 0 || uploading}
          >
            {uploading ? "Uploading..." : `Upload ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
