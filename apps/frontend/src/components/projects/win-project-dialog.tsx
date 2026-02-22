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
import type { Project, ProjectCore } from "@/types/project";
import { FileText, ImageIcon, File, Plus, X } from "lucide-react";

interface WinProjectDialogProps {
  project: Project & { coreDetail: ProjectCore | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className="size-3.5 text-purple-500" />;
  if (mimeType === "application/pdf")
    return <FileText className="size-3.5 text-red-500" />;
  return <File className="size-3.5 text-muted-foreground" />;
}

export function WinProjectDialog({
  project,
  open,
  onOpenChange,
}: WinProjectDialogProps) {
  const [picId, setPicId] = useState<string | undefined>(project.picId?.value);
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
        picId,
        status: "on_going",
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Win Project — {project.coreDetail?.name.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>PIC</Label>
              <UserCombobox value={picId} onChange={setPicId} />
            </div>
            <div className="space-y-2">
              <Label>Description / Brief</Label>
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder="Enter project brief..."
              />
            </div>
            <div className="space-y-2">
              <Label>Attachments</Label>
              {files.map((file) => (
                <div key={file.id} className="flex items-center gap-2 group">
                  <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
                  <span
                    className="text-sm truncate flex-1"
                    title={file.mediaFileInfo.originalFileName}
                  >
                    {file.mediaFileInfo.originalFileName}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatFileSize(file.mediaFileInfo.size)}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-5 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={() => deleteMedia.mutate(file.id)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs w-full justify-start text-muted-foreground"
                onClick={() => inputRef.current?.click()}
              >
                <Plus className="size-3 mr-1" />
                Attach file
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
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateProject.isPending}>
              {updateProject.isPending ? "Saving..." : "Save & Start Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
