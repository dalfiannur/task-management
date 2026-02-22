import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FileText,
  FileSpreadsheet,
  File,
  Download,
  Trash2,
  Link2,
} from "lucide-react";
import type { MediaFile } from "@/types/media";
import { isImage, formatFileSize } from "@/types/media";
import { useDeleteMedia } from "@/hooks/use-media";

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf")
    return <FileText className="size-10 text-red-500" />;
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("csv")
  )
    return <FileSpreadsheet className="size-10 text-green-600" />;
  if (mimeType.includes("word") || mimeType.includes("document"))
    return <FileText className="size-10 text-blue-500" />;
  return <File className="size-10 text-muted-foreground" />;
}

interface MediaGridProps {
  files: MediaFile[];
  isLoading: boolean;
}

export function MediaGrid({ files, isLoading }: MediaGridProps) {
  const deleteMedia = useDeleteMedia();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <File className="size-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No files uploaded yet</p>
        <p className="text-xs">Upload files to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {files.map((file) => (
        <Card key={file.id} className="group relative overflow-hidden">
          <div className="aspect-square flex items-center justify-center bg-muted/50">
            {isImage(file.mediaFileInfo.mimeType) &&
            file.mediaFileInfo.url ? (
              <img
                src={file.mediaFileInfo.url}
                alt={file.mediaFileInfo.originalFileName}
                className="object-cover w-full h-full"
              />
            ) : (
              <FileIcon mimeType={file.mediaFileInfo.mimeType} />
            )}
          </div>
          <div className="p-2 space-y-1">
            <p
              className="text-xs font-medium truncate"
              title={file.mediaFileInfo.originalFileName}
            >
              {file.mediaFileInfo.originalFileName}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {formatFileSize(file.mediaFileInfo.size)}
              </span>
              {file.mediaFileInfo.taskId && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1 py-0 h-4"
                >
                  <Link2 className="size-2.5 mr-0.5" />
                  Linked
                </Badge>
              )}
            </div>
          </div>
          {/* Hover overlay with actions */}
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {file.mediaFileInfo.url && (
              <Button
                size="icon"
                variant="secondary"
                className="size-8"
                asChild
              >
                <a
                  href={file.mediaFileInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-4" />
                </a>
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="destructive" className="size-8">
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &quot;
                    {file.mediaFileInfo.originalFileName}&quot;.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMedia.mutate(file.id)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      ))}
    </div>
  );
}
