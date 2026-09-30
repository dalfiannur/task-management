import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Download,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  MoreHorizontal,
  Presentation,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, getInitials } from "@/lib/utils";
import type { AppUser } from "@/features/auth";
import { useMediaPreviewUrl } from "../api/hooks";
import {
  fileExtension,
  fileKind,
  formatBytes,
  type FileKind,
} from "../api/mappers";
import type { MediaFile } from "../types";

const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: FileImage,
  video: FileVideoCamera,
  audio: FileMusic,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  code: FileCode,
  other: File,
};

// Column widths shared by the list header and its rows, so they line up.
const MEDIA_COLS = {
  type: "w-16 shrink-0",
  size: "w-20 shrink-0 text-right",
  uploader: "w-40 shrink-0",
  date: "w-28 shrink-0",
  actions: "w-8 shrink-0",
};

export interface MediaItemProps {
  file: MediaFile;
  uploader?: AppUser;
  canDelete: boolean;
  onDownload: (file: MediaFile) => void;
  onDelete: (file: MediaFile) => void;
}

const nameOf = (f: MediaFile) => f.originalFileName || f.fileName;

function formatDate(iso: string) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return "—";
  }
}

/** Image thumbnail when the file is one and its url resolves; otherwise the
 *  kind's icon on a sunken tile. Colour stays neutral — kind is not status. */
function Thumb({
  file,
  className,
  iconClassName,
}: {
  file: MediaFile;
  className?: string;
  iconClassName?: string;
}) {
  const kind = fileKind(file);
  const { url } = useMediaPreviewUrl(file.id, kind === "image");
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICON[kind];
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-surface-sunken",
        className,
      )}
    >
      {kind === "image" && url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon
          aria-hidden="true"
          strokeWidth={1.5}
          className={cn("text-text-subtle", iconClassName)}
        />
      )}
    </div>
  );
}

/** Download + Delete (behind a confirmation), shared by card and row. */
function ItemMenu({
  file,
  canDelete,
  onDownload,
  onDelete,
  className,
}: Omit<MediaItemProps, "uploader"> & { className?: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", className)}
            aria-label={`Actions for ${nameOf(file)}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onDownload(file)}>
            <Download className="h-4 w-4" />
            Download
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirming(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{nameOf(file)}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file from the project and from every
              task it is attached to. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(file)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function MediaCard(props: MediaItemProps) {
  const { file, onDownload } = props;
  return (
    <li className="group relative overflow-hidden rounded-xl bg-surface-raised shadow-2">
      <button
        type="button"
        onClick={() => onDownload(file)}
        className="block w-full text-left focus-visible:outline-none"
        aria-label={`Open ${nameOf(file)}`}
      >
        <Thumb
          file={file}
          className="aspect-[4/3] w-full"
          iconClassName="h-12 w-12"
        />
      </button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={nameOf(file)}>
            {nameOf(file)}
          </p>
          <p className="text-num truncate text-xs text-text-muted">
            {formatBytes(file.size)} · {formatDate(file.createdAt)}
          </p>
        </div>
        <ItemMenu
          {...props}
          className="-mr-1 shrink-0 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        />
      </div>
    </li>
  );
}

export function MediaRowHeader() {
  return (
    <div
      aria-hidden="true"
      className="hidden items-center gap-3 border-b border-border-subtle bg-surface-sunken/40 px-4 py-1.5 text-label md:flex"
    >
      <span className="flex-1">Name</span>
      <span className={MEDIA_COLS.type}>Type</span>
      <span className={MEDIA_COLS.size}>Size</span>
      <span className={MEDIA_COLS.uploader}>Uploaded by</span>
      <span className={MEDIA_COLS.date}>Date</span>
      <span className={MEDIA_COLS.actions} />
    </div>
  );
}

export function MediaRow(props: MediaItemProps) {
  const { file, uploader, onDownload } = props;
  const uploaderName = uploader?.displayName || uploader?.phone || "Unknown";
  return (
    <li className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Thumb
          file={file}
          className="h-9 w-9 shrink-0 rounded-md"
          iconClassName="h-5 w-5"
        />
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onDownload(file)}
            className="block max-w-full truncate text-left text-sm font-medium hover:underline"
            title={nameOf(file)}
          >
            {nameOf(file)}
          </button>
          {/* Below md the columns are hidden; the details ride under the name. */}
          <span className="text-num block truncate text-xs text-text-muted md:hidden">
            {formatBytes(file.size)} · {formatDate(file.createdAt)} ·{" "}
            {uploaderName}
          </span>
        </div>
      </div>
      <span
        className={cn(
          MEDIA_COLS.type,
          "hidden truncate text-xs text-text-muted md:block",
        )}
      >
        {fileExtension(file)}
      </span>
      <span
        className={cn(
          MEDIA_COLS.size,
          "text-num hidden text-sm text-text-muted md:block",
        )}
      >
        {formatBytes(file.size)}
      </span>
      <span
        className={cn(MEDIA_COLS.uploader, "hidden items-center gap-2 md:flex")}
      >
        <Avatar size="sm">
          {uploader?.avatarUrl && <AvatarImage src={uploader.avatarUrl} />}
          <AvatarFallback>{getInitials(uploaderName)}</AvatarFallback>
        </Avatar>
        <span className="truncate text-sm">{uploaderName}</span>
      </span>
      <span
        className={cn(
          MEDIA_COLS.date,
          "text-num hidden text-sm text-text-muted md:block",
        )}
      >
        {formatDate(file.createdAt)}
      </span>
      <ItemMenu {...props} className={MEDIA_COLS.actions} />
    </li>
  );
}
