import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Link2,
  Loader2,
  MoreHorizontal,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/users";
import type { Page } from "../types";
import { useUpdatePage, useDeletePage } from "../api/hooks";
import { editedAgo, formatDate } from "../format";

const AUTOSAVE_MS = 1000;

const ICONS = [
  "📄", "📝", "📌", "📋", "📎", "📚", "📖", "🗂️",
  "💡", "🎯", "🚀", "✅", "⚠️", "🐛", "🔧", "⚙️",
  "🧪", "📊", "📈", "🗓️", "🤝", "💬", "🔒", "🎨",
];

type Draft = { title: string; icon: string; content: string };
type SaveStatus = "saved" | "dirty" | "saving" | "error";

const sameDraft = (a: Draft, b: Draft) =>
  a.title === b.title && a.icon === b.icon && a.content === b.content;

/** One wiki page as a document: icon, title, meta line and rich text.
 *
 *  Autosaves a second after the last keystroke, on Ctrl/⌘+S, and on unmount
 *  (switching pages, leaving the tab) — so nothing typed is lost. The draft is
 *  seeded once from `page` (the parent keys this by page id) and is NOT
 *  re-synced from later props: the refetch that follows every save would
 *  otherwise overwrite whatever was typed while the request was in flight. */
export function PageEditor({
  page,
  onDeleted,
  onBack,
}: {
  page: Page;
  onDeleted: () => void;
  /** Mobile only: return to the page list. */
  onBack: () => void;
}) {
  const update = useUpdatePage();
  const del = useDeletePage();
  const userMap = useUserMap();

  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [content, setContent] = useState(page.content);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [iconOpen, setIconOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saved = useRef<Draft>({
    title: page.title,
    icon: page.icon,
    content: page.content,
  });
  const latest = useRef<Draft>(saved.current);
  const inflight = useRef(false);
  const again = useRef(false);
  const deleted = useRef(false);
  // The mutation object changes identity every render; reading it through a
  // ref keeps `flush` stable so the debounce timer isn't reset by re-renders.
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  });

  const flush = useCallback(async () => {
    if (deleted.current) return;
    if (inflight.current) {
      again.current = true;
      return;
    }
    const snap = latest.current;
    if (sameDraft(snap, saved.current)) {
      setStatus("saved");
      return;
    }
    inflight.current = true;
    setStatus("saving");
    try {
      await updateRef.current.mutateAsync({ id: page.id, ...snap });
      saved.current = snap;
      setStatus(sameDraft(latest.current, snap) ? "saved" : "dirty");
    } catch (e) {
      setStatus("error");
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [page.id]);

  // Debounced autosave on every edit.
  useEffect(() => {
    latest.current = { title, icon, content };
    if (sameDraft(latest.current, saved.current)) return;
    setStatus((s) => (s === "saving" ? s : "dirty"));
    const t = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [title, icon, content, flush]);

  // Flush on unmount — fire-and-forget; the mutation outlives the component.
  useEffect(() => {
    const id = page.id;
    return () => {
      if (!deleted.current && !sameDraft(latest.current, saved.current)) {
        updateRef.current.mutate({ id, ...latest.current });
      }
    };
  }, [page.id]);

  // Ctrl/⌘+S saves now; closing the browser with unsaved edits asks first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!sameDraft(latest.current, saved.current)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush]);

  function remove() {
    deleted.current = true;
    del.mutate(
      { id: page.id },
      {
        onSuccess: () => {
          toast.success("Page deleted.");
          onDeleted();
        },
        onError: (e) => {
          deleted.current = false;
          toast.error(e.message || "Delete failed");
        },
      },
    );
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  const editor = userMap[page.lastEditedBy];
  const creator = userMap[page.createdBy];
  const editorName = editor?.displayName || editor?.phone;
  const creatorName = creator?.displayName || creator?.phone;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          onClick={onBack}
          aria-label="Back to pages"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <SaveIndicator status={status} onRetry={() => void flush()} />
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Page actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyLink()}>
                <Link2 className="h-4 w-4" />
                Copy link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-3xl px-6 pb-16 pt-8 sm:px-10">
          <Popover open={iconOpen} onOpenChange={setIconOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={icon ? "Change icon" : "Add icon"}
                className={cn(
                  "mb-2 flex items-center justify-center rounded-lg",
                  "transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover",
                  icon
                    ? "h-14 w-14 text-5xl leading-none"
                    : "h-8 gap-1.5 px-2 text-sm text-text-muted",
                )}
              >
                {icon || (
                  <>
                    <SmilePlus className="h-4 w-4" />
                    Add icon
                  </>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <div className="grid grid-cols-8 gap-1">
                {ICONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setIcon(e);
                      setIconOpen(false);
                    }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-surface-hover",
                      icon === e && "bg-surface-sunken",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <Input
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="Or type one"
                    maxLength={2}
                    aria-label="Custom icon"
                  />
                </span>
                {icon && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIcon("");
                      setIconOpen(false);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            aria-label="Page title"
            className="w-full bg-transparent text-3xl font-semibold tracking-tight text-text outline-none placeholder:text-text-subtle"
          />

          <p className="mt-2 text-xs text-text-muted">
            Edited {editedAgo(page.updatedAt)}
            {editorName && <> by {editorName}</>}
            {page.createdAt && (
              <>
                {" "}
                · Created {formatDate(page.createdAt)}
                {creatorName && <> by {creatorName}</>}
              </>
            )}
          </p>

          <RichTextEditor
            variant="document"
            className="mt-6"
            value={content}
            onChange={setContent}
            placeholder="Write the page…"
          />
        </article>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{title || "Untitled"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the page. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 text-xs text-danger hover:underline"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Not saved — retry
      </button>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 text-xs text-text-muted"
    >
      {status === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving…
        </>
      ) : status === "dirty" ? (
        "Unsaved changes"
      ) : (
        <>
          <Check className="h-3.5 w-3.5" />
          Saved
        </>
      )}
    </span>
  );
}
