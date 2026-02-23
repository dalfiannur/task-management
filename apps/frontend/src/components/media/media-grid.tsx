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
import styles from "./media-grid.module.css";

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf")
    return <FileText className={styles.fileIconRed} />;
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("csv")
  )
    return <FileSpreadsheet className={styles.fileIconGreen} />;
  if (mimeType.includes("word") || mimeType.includes("document"))
    return <FileText className={styles.fileIconBlue} />;
  return <File className={styles.fileIconMuted} />;
}

interface MediaGridProps {
  files: MediaFile[];
  isLoading: boolean;
}

export function MediaGrid({ files, isLoading }: MediaGridProps) {
  const deleteMedia = useDeleteMedia();

  if (isLoading) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className={styles.skeletonItem} />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className={styles.emptyState}>
        <File className={styles.emptyIcon} />
        <p className={styles.emptyTitle}>No files uploaded yet</p>
        <p className={styles.emptySubtitle}>Upload files to get started</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {files.map((file) => (
        <Card key={file.id} className={styles.card}>
          <div className={styles.thumbnail}>
            {isImage(file.mediaFileInfo.mimeType) &&
            file.mediaFileInfo.url ? (
              <img
                src={file.mediaFileInfo.url}
                alt={file.mediaFileInfo.originalFileName}
                className={styles.image}
              />
            ) : (
              <FileIcon mimeType={file.mediaFileInfo.mimeType} />
            )}
          </div>
          <div className={styles.info}>
            <p
              className={styles.fileName}
              title={file.mediaFileInfo.originalFileName}
            >
              {file.mediaFileInfo.originalFileName}
            </p>
            <div className={styles.fileMeta}>
              <span className={styles.fileSize}>
                {formatFileSize(file.mediaFileInfo.size)}
              </span>
              {file.mediaFileInfo.taskId && (
                <Badge
                  variant="secondary"
                  className={styles.linkedBadge}
                >
                  <Link2 className={styles.linkedIcon} />
                  Linked
                </Badge>
              )}
            </div>
          </div>
          {/* Hover overlay with actions */}
          <div className={styles.overlay}>
            {file.mediaFileInfo.url && (
              <Button
                size="icon"
                variant="secondary"
                className={styles.actionBtn}
                asChild
              >
                <a
                  href={file.mediaFileInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className={styles.actionIcon} />
                </a>
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="destructive" className={styles.actionBtn}>
                  <Trash2 className={styles.actionIcon} />
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
