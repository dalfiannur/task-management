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

interface TaskAttachmentsProps {
  projectId: string;
  taskId: string;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className="size-3.5 text-purple-500" />;
  if (mimeType === "application/pdf")
    return <FileText className="size-3.5 text-red-500" />;
  return <File className="size-3.5 text-muted-foreground" />;
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
    <div className="space-y-2">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-2 group"
        >
          <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
          <span className="text-sm truncate flex-1" title={file.mediaFileInfo.originalFileName}>
            {file.mediaFileInfo.originalFileName}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatFileSize(file.mediaFileInfo.size)}
          </span>
          <Button
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
  );
}
