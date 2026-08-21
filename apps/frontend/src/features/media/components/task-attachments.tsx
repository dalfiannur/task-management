import { useRef, useState } from "react";
import { Download, File, FileImage, Link2, Paperclip, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useTaskMedia,
  useProjectMedia,
  useUploadFile,
  useLinkTaskMedia,
  useUnlinkTaskMedia,
  useDownloadUrl,
} from "../api/hooks";
import { formatBytes } from "../api/mappers";
import type { MediaFile } from "../types";

function displayName(f: MediaFile): string {
  return f.originalFileName || f.fileName;
}

/**
 * Files attached to one task.
 *
 * A task attachment is a *link* to a file that lives in the project, not a
 * copy — the same spec can hang off several tasks. So the remove action here
 * unlinks; deleting the file itself stays in the Media tab, which asks for
 * confirmation. Both paths exist on the server already (LinkTaskMedia /
 * UnlinkTaskMedia / ListTaskMedia); this only surfaces them.
 *
 * Edit mode only — an unsaved task has no id to link against, the same rule
 * the subtask and dependency sections follow.
 */
export function TaskAttachments({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const { files, isLoading } = useTaskMedia(taskId);
  const { files: projectFiles } = useProjectMedia(projectId);
  const { upload, uploading } = useUploadFile(projectId);
  const link = useLinkTaskMedia();
  const unlink = useUnlinkTaskMedia();
  const download = useDownloadUrl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const linkedIds = new Set(files.map((f) => f.id));
  const linkable = projectFiles.filter((f) => !linkedIds.has(f.id));

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      try {
        const mediaFileId = await upload(file);
        await link.mutateAsync({ taskId, mediaFileId });
        toast.success(`Attached ${file.name}`);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Failed to attach ${file.name}`,
        );
      }
    }
    // Clearing lets the same file be picked again after a failed attempt.
    if (inputRef.current) inputRef.current.value = "";
  }

  function onLinkExisting(f: MediaFile) {
    setPickerOpen(false);
    link.mutate(
      { taskId, mediaFileId: f.id },
      {
        onSuccess: () => toast.success(`Attached ${displayName(f)}`),
        onError: (e) => toast.error(e.message || "Failed to attach file"),
      },
    );
  }

  function onUnlink(f: MediaFile) {
    unlink.mutate(
      { taskId, mediaFileId: f.id },
      {
        onSuccess: () => toast.success(`Detached ${displayName(f)}`),
        onError: (e) => toast.error(e.message || "Failed to detach file"),
      },
    );
  }

  async function onDownload(f: MediaFile) {
    try {
      const { url } = await download.mutateAsync({ mediaFileId: f.id });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to get download link",
      );
    }
  }

  const picker = (
    <input
      ref={inputRef}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => onFiles(e.target.files)}
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading attachments">
        <Label>Attachments</Label>
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  const empty = files.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>
          Attachments
          {!empty && (
            <span className="text-num ml-1 text-text-muted">{files.length}</span>
          )}
        </Label>
        <div className="flex items-center gap-1">
          {picker}
          {/* Upload lives in the header only once there is a list. While the
              section is empty the empty state carries it as the single primary
              CTA (ui-design rule 9), and repeating it here would be two calls
              to the same action. Linking stays reachable either way: a fresh
              task may well want a spec that is already in the project. */}
          {!empty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip className="mr-1 h-4 w-4" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          )}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Link2 className="mr-1 h-4 w-4" />
                Link existing
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1" align="end">
              {linkable.length === 0 ? (
                <p className="p-2 text-sm text-text-muted">
                  {projectFiles.length === 0
                    ? "No files in this project yet."
                    : "Every project file is already attached."}
                </p>
              ) : (
                <ul className="max-h-60 space-y-0.5 overflow-y-auto">
                  {linkable.map((f) => {
                    const Icon = f.mimeType.startsWith("image/")
                      ? FileImage
                      : File;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => onLinkExisting(f)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {displayName(f)}
                          </span>
                          <span className="text-num shrink-0 text-xs text-text-muted">
                            {formatBytes(f.size)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {empty ? (
        <EmptyState
          size="compact"
          icon={Paperclip}
          title="No attachments yet"
          body="Attach a file here so the team doesn't have to hunt for it in the Media tab."
          actionSlot={
            <Button
              type="button"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip className="mr-1 h-4 w-4" />
              {uploading ? "Uploading…" : "Attach a file"}
            </Button>
          }
        />
      ) : (
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {files.map((f) => {
          const Icon = f.mimeType.startsWith("image/") ? FileImage : File;
          return (
            <li key={f.id} className="group flex items-center gap-2 px-3 py-2">
              <Icon className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {displayName(f)}
              </span>
              <span className="text-num shrink-0 text-xs text-text-muted">
                {formatBytes(f.size)}
              </span>
              {/* Revealed on focus as well as hover — opacity alone hides these
                  controls from keyboard users entirely. */}
              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onDownload(f)}
                  disabled={download.isPending}
                  aria-label={`Download ${displayName(f)}`}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onUnlink(f)}
                  disabled={unlink.isPending}
                  aria-label={`Detach ${displayName(f)} from this task`}
                  title="Detach from task (the file stays in the project)"
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}
