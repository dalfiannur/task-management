import { useRef } from "react";
import { Download, File, FileImage, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
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
  useProjectMedia,
  useUploadFile,
  useDeleteMedia,
  useDownloadUrl,
} from "../api/hooks";
import { formatBytes } from "../api/mappers";
import type { MediaFile } from "../types";

export function MediaTab({ projectId }: { projectId: string }) {
  const { files, isLoading } = useProjectMedia(projectId);
  const { upload, uploading } = useUploadFile(projectId);
  const del = useDeleteMedia();
  const download = useDownloadUrl();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      try {
        await upload(file);
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Failed to upload ${file.name}`);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onDownload(file: MediaFile) {
    try {
      const { url } = await download.mutateAsync({ mediaFileId: file.id });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to get download link");
    }
  }

  function onDelete(file: MediaFile) {
    del.mutate(
      { mediaFileId: file.id },
      {
        onSuccess: () => toast.success("File deleted."),
        onError: (e) => toast.error(e.message || "Delete failed"),
      },
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          Media <span className="text-text-muted">({files.length})</span>
        </h2>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <Button
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="mr-1 h-4 w-4" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl shadow-2" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
          No files yet. Upload to share files with the project.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => {
            const isImage = f.mimeType.startsWith("image/");
            const Icon = isImage ? FileImage : File;
            return (
              <li
                key={f.id}
                className="group flex items-center gap-3 rounded-xl bg-surface-raised p-3 shadow-2"
              >
                <Icon className="h-8 w-8 shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {f.originalFileName || f.fileName}
                  </p>
                  <p className="text-num text-xs text-text-muted">
                    {formatBytes(f.size)}
                  </p>
                </div>
                <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onDownload(f)}
                    disabled={download.isPending}
                    aria-label="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Delete file"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete “{f.originalFileName || f.fileName}”?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the file. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(f)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
