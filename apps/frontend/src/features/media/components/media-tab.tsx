import { useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  CloudUpload,
  FolderOpen,
  LayoutGrid,
  List,
  Search,
  SearchX,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useProjectMembers } from "@/features/projects";
import { useUserMap } from "@/features/users";
import {
  useProjectMedia,
  useUploadFile,
  useDeleteMedia,
  useDownloadUrl,
} from "../api/hooks";
import { fileKind, formatBytes, type FileKind } from "../api/mappers";
import { mediaViewAtom, type MediaView } from "../atoms/view";
import type { MediaFile } from "../types";
import { MediaCard, MediaRow, MediaRowHeader } from "./media-item";

type Filter = "all" | "images" | "documents" | "other";

const DOCUMENT_KINDS: FileKind[] = [
  "pdf",
  "document",
  "spreadsheet",
  "presentation",
];

function filterOf(f: MediaFile): Exclude<Filter, "all"> {
  const kind = fileKind(f);
  if (kind === "image") return "images";
  if (DOCUMENT_KINDS.includes(kind)) return "documents";
  return "other";
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "images", label: "Images" },
  { key: "documents", label: "Documents" },
  { key: "other", label: "Other" },
];

const VIEWS: { key: MediaView; label: string; icon: typeof List }[] = [
  { key: "grid", label: "Grid view", icon: LayoutGrid },
  { key: "list", label: "List view", icon: List },
];

const GRID = "grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

/** Pill-in-a-trough segmented control — same as /projects. */
const segment = (on: boolean) =>
  cn(
    "rounded-full text-sm",
    "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
    on
      ? "bg-surface-raised font-medium text-text shadow-1"
      : "text-text-muted hover:text-text",
  );

const nameOf = (f: MediaFile) => f.originalFileName || f.fileName;

export function MediaTab({ projectId }: { projectId: string }) {
  const { files, isLoading } = useProjectMedia(projectId);
  const { upload } = useUploadFile(projectId);
  const del = useDeleteMedia();
  const download = useDownloadUrl();
  const { ownerId } = useProjectMembers(projectId);
  const userMap = useUserMap();
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const inputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useAtom(mediaViewAtom);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  // Files of the current batch done / in total; null when idle.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // dragenter/leave fire per child element; a counter tells the real exit.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: files.length, images: 0, documents: 0, other: 0 };
    for (const f of files) c[filterOf(f)]++;
    return c;
  }, [files]);

  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + f.size, 0),
    [files],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return files
      .filter((f) => filter === "all" || filterOf(f) === filter)
      .filter((f) => !needle || nameOf(f).toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [files, filter, q]);

  const uploading = progress !== null;
  const searching = q.trim().length > 0;
  const filtered = searching || filter !== "all";

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0 || uploading) return;
    const batch = Array.from(list);
    let ok = 0;
    setProgress({ done: 0, total: batch.length });
    for (const [i, file] of batch.entries()) {
      try {
        await upload(file);
        ok++;
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Failed to upload ${file.name}`,
        );
      }
      setProgress({ done: i + 1, total: batch.length });
    }
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    if (ok > 0) {
      toast.success(
        ok === 1 && batch.length === 1
          ? `Uploaded ${batch[0].name}`
          : `Uploaded ${ok} of ${batch.length} files`,
      );
    }
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

  // Mirrors the server rule: the uploader, the project owner, or an admin.
  const canDelete = (f: MediaFile) =>
    isAdmin || (!!me && (f.uploadedBy === me.id || ownerId === me.id));

  function clearFilters() {
    setQ("");
    setFilter("all");
  }

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  const pickFiles = () => inputRef.current?.click();

  const uploadButton = (
    <Button size="sm" onClick={pickFiles} disabled={uploading}>
      <Upload className="mr-1 h-4 w-4" />
      {progress
        ? `Uploading ${Math.min(progress.done + 1, progress.total)}/${progress.total}…`
        : "Upload"}
    </Button>
  );

  return (
    <div
      className="relative min-h-full space-y-4 p-6"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void onFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-brand-subtle/80 text-brand-text"
        >
          <CloudUpload className="h-10 w-10" strokeWidth={1.5} />
          <p className="text-sm font-medium">Drop files to upload</p>
        </div>
      )}

      {/* Controls only when there is something to operate on, or when one of
          them is the reason the list is empty (empty-states.md §3). */}
      {(files.length > 0 || filtered) && (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter by type"
            className="inline-flex gap-1 overflow-x-auto rounded-full bg-surface-sunken p-[3px]"
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(segment(filter === f.key), "px-3 py-1")}
              >
                {f.label}{" "}
                <span className="text-num text-xs text-text-muted">
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
          <div className="relative order-last w-full sm:order-none sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
            <Input
              type="search"
              placeholder="Search files…"
              aria-label="Search files"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="!pl-8" /* beats the module's padding shorthand */
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div
              role="group"
              aria-label="Layout"
              className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]"
            >
              {VIEWS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  aria-label={label}
                  title={label}
                  className={cn(segment(view === key), "p-1.5")}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            {uploadButton}
          </div>
        </div>
      )}

      {isLoading ? (
        view === "grid" ? (
          <div className={GRID}>
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/5] w-full rounded-xl shadow-2" />
            ))}
          </div>
        ) : (
          <Skeleton className="h-72 w-full rounded-xl shadow-2" />
        )
      ) : files.length === 0 ? (
        <div className="rounded-xl bg-surface-raised shadow-2">
          <EmptyState
            icon={FolderOpen}
            title="Project files live here"
            body="Upload designs, documents and references, or drop files anywhere on this tab."
            actionSlot={
              <Button onClick={pickFiles} disabled={uploading}>
                <Upload className="mr-1 h-4 w-4" />
                {uploading ? "Uploading…" : "Upload files"}
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-surface-raised shadow-2">
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="No files match"
            body={
              searching
                ? `Nothing named like “${q.trim()}” in this view.`
                : "No files of this type yet."
            }
            action={{ label: "Clear filters", onClick: clearFilters }}
          />
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="text-label">
            Files{" "}
            <span className="text-num">
              ({visible.length === files.length
                ? files.length
                : `${visible.length} / ${files.length}`}{" "}
              · {formatBytes(totalBytes)})
            </span>
          </h2>
          {view === "grid" ? (
            <ul className={GRID}>
              {visible.map((f) => (
                <MediaCard
                  key={f.id}
                  file={f}
                  uploader={userMap[f.uploadedBy]}
                  canDelete={canDelete(f)}
                  onDownload={onDownload}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          ) : (
            <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
              <MediaRowHeader />
              <ul>
                {visible.map((f) => (
                  <MediaRow
                    key={f.id}
                    file={f}
                    uploader={userMap[f.uploadedBy]}
                    canDelete={canDelete(f)}
                    onDownload={onDownload}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
