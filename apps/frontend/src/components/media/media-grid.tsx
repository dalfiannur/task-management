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
  Share2,
} from "lucide-react";
import type { MediaFile } from "@/types/media";
import { isImage, formatFileSize } from "@/types/media";
import { useDeleteMedia, useToggleMediaVisibility } from "@/hooks/use-media";
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
  readOnly?: boolean;
  projectId?: string;
  visibilityMap?: Map<string, "private" | "shared">;
}

export function MediaGrid({ files, isLoading, readOnly, projectId, visibilityMap }: MediaGridProps) {
  const deleteMedia = useDeleteMedia();
  const toggleVisibility = useToggleMediaVisibility();

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
      {files.map((file) => {
        const isShared = file.isFromSharedProject;
        const currentVisibility = visibilityMap?.get(file.id) ?? file.visibility ?? "private";
        const isFileShared = currentVisibility === "shared";

        return (
          <Card key={file.id} className={styles.card}>
            {isShared && file.sourceProjectName && (
              <span className={styles.sourceProjectBadge} title={file.sourceProjectName}>
                {file.sourceProjectName}
              </span>
            )}
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
                <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                  {isFileShared && !isShared && (
                    <Badge variant="outline" className={styles.sharedBadge}>
                      <Share2 className={styles.sharedIcon} />
                      Shared
                    </Badge>
                  )}
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
              {!readOnly && !isShared && projectId && (
                <Button
                  size="icon"
                  variant={isFileShared ? "default" : "secondary"}
                  className={styles.actionBtn}
                  title={isFileShared ? "Unshare file" : "Share with sub-projects"}
                  onClick={() =>
                    toggleVisibility.mutate({
                      mediaFileId: file.id,
                      projectId,
                      visibility: isFileShared ? "private" : "shared",
                      originalFileName: file.mediaFileInfo.originalFileName,
                      mimeType: file.mediaFileInfo.mimeType,
                      size: file.mediaFileInfo.size,
                      url: file.mediaFileInfo.url,
                    })
                  }
                >
                  <Share2 className={styles.actionIcon} />
                </Button>
              )}
              {!readOnly && !isShared && (
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
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
