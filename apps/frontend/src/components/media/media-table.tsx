import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  ImageIcon,
  Download,
  Trash2,
  Link2,
  Share2,
} from "lucide-react";
import type { MediaFile } from "@/types/media";
import { isImage, formatFileSize } from "@/types/media";
import { useDeleteMedia, useToggleMediaVisibility } from "@/hooks/use-media";
import styles from "./media-table.module.css";

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className={styles.fileTypeIconPurple} />;
  if (mimeType === "application/pdf")
    return <FileText className={styles.fileTypeIconRed} />;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return <FileSpreadsheet className={styles.fileTypeIconGreen} />;
  if (mimeType.includes("word") || mimeType.includes("document"))
    return <FileText className={styles.fileTypeIconBlue} />;
  return <File className={styles.fileTypeIconMuted} />;
}

function getMimeLabel(mimeType: string): string {
  if (isImage(mimeType)) return mimeType.split("/")[1]!.toUpperCase();
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word") || mimeType.includes("document")) return "DOCX";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return "XLSX";
  return mimeType.split("/")[1]?.toUpperCase() ?? "FILE";
}

interface MediaTableProps {
  files: MediaFile[];
  isLoading: boolean;
  readOnly?: boolean;
  projectId?: string;
  visibilityMap?: Map<string, "private" | "shared">;
}

export function MediaTable({ files, isLoading, readOnly, projectId, visibilityMap }: MediaTableProps) {
  const deleteMedia = useDeleteMedia();
  const toggleVisibility = useToggleMediaVisibility();

  if (isLoading) {
    return (
      <div className={styles.loadingList}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className={styles.skeletonRow} />
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
    <div className={styles.tableWrapper}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className={styles.typeCol}>Type</TableHead>
            <TableHead className={styles.sizeCol}>Size</TableHead>
            <TableHead className={styles.linkedCol}>Linked Task</TableHead>
            <TableHead className={styles.actionsCol}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => {
            const isShared = file.isFromSharedProject;
            const currentVisibility = visibilityMap?.get(file.id) ?? file.visibility ?? "private";
            const isFileShared = currentVisibility === "shared";

            return (
              <TableRow key={file.id}>
                <TableCell>
                  <div className={styles.nameCell}>
                    <FileTypeIcon mimeType={file.mediaFileInfo.mimeType} />
                    <span className={styles.fileNameText}>
                      {file.mediaFileInfo.originalFileName}
                    </span>
                    {isShared && file.sourceProjectName && (
                      <span className={styles.sourceProjectText}>
                        ({file.sourceProjectName})
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={styles.typeBadge}>
                    {getMimeLabel(file.mediaFileInfo.mimeType)}
                  </Badge>
                </TableCell>
                <TableCell className={styles.sizeText}>
                  {formatFileSize(file.mediaFileInfo.size)}
                </TableCell>
                <TableCell>
                  <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                    {isFileShared && !isShared && (
                      <Badge variant="outline" className={styles.sharedBadge}>
                        <Share2 className={styles.sharedIcon} />
                        Shared
                      </Badge>
                    )}
                    {file.mediaFileInfo.taskId ? (
                      <Badge
                        variant="secondary"
                        className={styles.linkedBadge}
                      >
                        <Link2 className={styles.linkedIcon} />
                        Linked
                      </Badge>
                    ) : !isFileShared ? (
                      <span className={styles.noLink}>&mdash;</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className={styles.actionsCell}>
                  <div className={styles.actionsWrapper}>
                    {file.mediaFileInfo.url && (
                      <Button
                        size="icon"
                        variant="ghost"
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
                        variant="ghost"
                        className={styles.shareBtn}
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
                          <Button
                            size="icon"
                            variant="ghost"
                            className={styles.deleteBtn}
                          >
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
