import { useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useUpdateCoreProject, getProjectDisplayName } from "@/hooks/use-projects";
import { useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
import { useResolveMediaProjectId } from "@/hooks/use-media-project";
import { isImage, formatFileSize, type MediaFile } from "@/types/media";
import type { CoreProject } from "@/types/project";
import { FileText, ImageIcon, File, Plus, X } from "lucide-react";

interface CloseProjectDialogProps {
  project: CoreProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className="size-3.5 text-purple-400" />;
  if (mimeType === "application/pdf")
    return <FileText className="size-3.5 text-red-400" />;
  return <File className="size-3.5 text-muted-foreground" />;
}

export function CloseProjectDialog({
  project,
  open,
  onOpenChange,
}: CloseProjectDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const updateCoreProject = useUpdateCoreProject();
  const [reportFiles, setReportFiles] = useState<MediaFile[]>([]);
  const { mediaProjectId } = useResolveMediaProjectId(
    project.id,
    getProjectDisplayName(project),
  );

  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const uploaded = await uploadMedia.mutateAsync({ file, mediaProjectId: mediaProjectId ?? "", projectId: project.id });
      setReportFiles((prev) => [...prev, uploaded]);
    }
    e.target.value = "";
  };

  const handleRemoveFile = useCallback((fileId: string) => {
    deleteMedia.mutate(fileId);
    setReportFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, [deleteMedia]);

  const handleOpenChange = useCallback((value: boolean) => {
    if (!value) setReportFiles([]);
    onOpenChange(value);
  }, [onOpenChange]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateCoreProject.mutate(
      { id: project.id, status: "completed" },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[32rem]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Close Project</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3.5">
            <p className="text-sm leading-[1.375rem] text-muted-foreground">
              This will permanently close the project. Closed projects cannot be
              reopened, and no new modules or tasks can be created.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>Report Files</Label>
              {reportFiles.map((file) => (
                <div key={file.id} className="group flex items-center gap-1.5">
                  <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
                  <span
                    className="text-sm leading-5 truncate flex-1"
                    title={file.mediaFileInfo.originalFileName}
                  >
                    {file.mediaFileInfo.originalFileName}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground shrink-0">
                    {formatFileSize(file.mediaFileInfo.size)}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-[1.125rem] opacity-0 group-hover:opacity-100 shrink-0 transition-all duration-300 active:scale-95"
                    onClick={() => handleRemoveFile(file.id)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-sm leading-4 w-full justify-start text-muted-foreground transition-all duration-300 active:scale-95"
                onClick={() => inputRef.current?.click()}
              >
                <Plus className="size-3 mr-1" />
                Attach report file
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-purple-500/80 backdrop-blur-md text-white border border-purple-400/40 transition-all duration-300 active:scale-95 hover:bg-purple-600/90 hover:shadow-[0_0_20px_rgb(124_58_237/0.3)]"
              disabled={updateCoreProject.isLoading}
            >
              {updateCoreProject.isLoading ? "Closing..." : "Close Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
