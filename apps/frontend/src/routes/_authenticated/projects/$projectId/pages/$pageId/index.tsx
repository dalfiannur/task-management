import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { usePage, useUpdatePage, useDeletePage } from "@/hooks/use-pages";
import { useUser } from "@/hooks/use-users";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
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
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ArrowLeft, Trash2, FileText } from "lucide-react";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/pages/$pageId/",
)({
  component: PageEditorPage,
});

const COMMON_EMOJIS = [
  "📝", "📄", "📋", "📌", "📎", "📂", "📁", "📚",
  "📖", "📒", "📓", "📔", "📕", "📗", "📘", "📙",
  "💡", "🎯", "🔧", "⚙️", "🚀", "✅", "❌", "⚠️",
  "🔍", "💬", "📊", "📈", "🗓️", "🏷️", "🔗", "🗂️",
];

function formatTimeAgo(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function PageEditorPage() {
  const { projectId, pageId } = Route.useParams();
  const navigate = useNavigate();
  const { data: page, isLoading } = usePage(pageId);
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const { data: lastEditor } = useUser(page?.pageInfo.lastEditedById);

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize state from page data
  useEffect(() => {
    if (page && !initialized) {
      setTitle(page.pageInfo.title);
      setIcon(page.pageInfo.icon);
      setInitialized(true);
    }
  }, [page, initialized]);

  const saveField = useCallback(
    (field: "title" | "icon" | "content", value: string) => {
      updatePage.mutate({
        id: pageId,
        projectId,
        [field]: value,
      });
    },
    [pageId, projectId, updatePage],
  );

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      saveField("title", newTitle);
    }, 1000);
  };

  const handleContentChange = useCallback(
    (html: string) => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
      contentTimerRef.current = setTimeout(() => {
        saveField("content", html);
      }, 1000);
    },
    [saveField],
  );

  const handleIconSelect = (emoji: string) => {
    const newIcon = icon === emoji ? "" : emoji;
    setIcon(newIcon);
    setEmojiOpen(false);
    saveField("icon", newIcon);
  };

  const handleDelete = () => {
    deletePage.mutate(
      { id: pageId, projectId },
      {
        onSuccess: () => {
          navigate({
            to: "/projects/$projectId/pages",
            params: { projectId },
          });
        },
      },
    );
  };

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Page not found
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
          <Link to="/projects/$projectId/pages" params={{ projectId }}>
            <ArrowLeft className="size-3.5 mr-1.5" />
            Back to Pages
          </Link>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5 mr-1.5" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete page?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{title || "Untitled"}&quot;. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Icon + Title */}
      <div className="flex items-start gap-3">
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button className="shrink-0 mt-1 size-10 flex items-center justify-center rounded-lg border border-dashed hover:bg-accent/50 transition-colors text-lg">
              {icon || <FileText className="size-5 text-muted-foreground" />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="grid grid-cols-8 gap-1">
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleIconSelect(emoji)}
                  className="size-8 flex items-center justify-center rounded hover:bg-accent transition-colors text-base"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="flex-1 text-2xl font-bold font-display tracking-tight bg-transparent border-0 outline-none placeholder:text-muted-foreground/40"
        />
      </div>

      {/* Editor */}
      {initialized && (
        <RichTextEditor
          content={page.pageInfo.content}
          onChange={handleContentChange}
          placeholder="Start writing..."
        />
      )}

      {/* Footer */}
      <p className="text-xs text-muted-foreground pt-2">
        Last edited by {lastEditor?.name || page.pageInfo.lastEditedByName || "Unknown"},{" "}
        {formatTimeAgo(page.pageInfo.updatedAt)}
      </p>
    </div>
  );
}
