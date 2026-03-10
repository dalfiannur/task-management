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

interface MediaUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  mediaProjectId?: string;
  taskId?: string;
}

export function MediaUploadDialog({
  open,
  onOpenChange,
  projectId,
  mediaProjectId,
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
        await uploadMedia.mutateAsync({ file, mediaProjectId: mediaProjectId ?? "", projectId, taskId });
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
      <DialogContent className="max-w-[28rem]">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            Select files to upload to this project.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "border-2 border-dashed border-border rounded-2xl p-6 text-center transition-all duration-300",
            dragOver && "border-primary bg-accent",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className="size-7 mx-auto mb-1.5 text-muted-foreground" />
          <p className="text-sm leading-5 text-muted-foreground mb-1.5">
            Drag & drop files here, or
          </p>
          <Button
            variant="outline"
            size="sm"
            className="transition-all duration-300 active:scale-95"
            onClick={() => inputRef.current?.click()}
          >
            Browse Files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {selectedFiles.length > 0 && (
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {selectedFiles.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-accent"
              >
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm leading-5 truncate flex-1">{file.name}</span>
                <span className="text-sm leading-4 text-muted-foreground shrink-0 font-mono">
                  {formatFileSize(file.size)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 shrink-0 transition-all duration-300 active:scale-95"
                  onClick={() => removeFile(i)}
                >
                  <X className="size-2.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-1.5">
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
