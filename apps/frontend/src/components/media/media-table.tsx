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
} from "lucide-react";
import type { MediaFile } from "@/types/media";
import { isImage, formatFileSize } from "@/types/media";
import { useDeleteMedia } from "@/hooks/use-media";

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className="size-4 text-purple-500" />;
  if (mimeType === "application/pdf")
    return <FileText className="size-4 text-red-500" />;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return <FileSpreadsheet className="size-4 text-green-600" />;
  if (mimeType.includes("word") || mimeType.includes("document"))
    return <FileText className="size-4 text-blue-500" />;
  return <File className="size-4 text-muted-foreground" />;
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
}

export function MediaTable({ files, isLoading }: MediaTableProps) {
  const deleteMedia = useDeleteMedia();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded" />
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-[80px]">Type</TableHead>
            <TableHead className="w-[80px]">Size</TableHead>
            <TableHead className="w-[100px]">Linked Task</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => (
            <TableRow key={file.id}>
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
                  <FileTypeIcon mimeType={file.mediaFileInfo.mimeType} />
                  <span className="text-sm truncate">
                    {file.mediaFileInfo.originalFileName}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px]">
                  {getMimeLabel(file.mediaFileInfo.mimeType)}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatFileSize(file.mediaFileInfo.size)}
              </TableCell>
              <TableCell>
                {file.mediaFileInfo.taskId ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    <Link2 className="size-2.5 mr-0.5" />
                    Linked
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {file.mediaFileInfo.url && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      asChild
                    >
                      <a
                        href={file.mediaFileInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="size-3.5" />
                      </a>
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
