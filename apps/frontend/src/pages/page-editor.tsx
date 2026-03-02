import { Link, useParams, useNavigate } from "react-router";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePage, useUpdatePage, useDeletePage } from "@/hooks/use-pages";
import { useUser } from "@/hooks/use-users";
import { useAllTasks } from "@/hooks/use-tasks";
import { useModules } from "@/hooks/use-modules";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Trash2, FileText, Link2, X, Search, Layers, CheckSquare } from "lucide-react";
import styles from "./page-editor.module.css";

const COMMON_EMOJIS = [
  "\u{1F4DD}", "\u{1F4C4}", "\u{1F4CB}", "\u{1F4CC}", "\u{1F4CE}", "\u{1F4C2}", "\u{1F4C1}", "\u{1F4DA}",
  "\u{1F4D6}", "\u{1F4D2}", "\u{1F4D3}", "\u{1F4D4}", "\u{1F4D5}", "\u{1F4D7}", "\u{1F4D8}", "\u{1F4D9}",
  "\u{1F4A1}", "\u{1F3AF}", "\u{1F527}", "\u2699\uFE0F", "\u{1F680}", "\u2705", "\u274C", "\u26A0\uFE0F",
  "\u{1F50D}", "\u{1F4AC}", "\u{1F4CA}", "\u{1F4C8}", "\u{1F5D3}\uFE0F", "\u{1F3F7}\uFE0F", "\u{1F517}", "\u{1F5C2}\uFE0F",
];

function resolveDisplayName(params: { name?: string; email?: string; snapshotName?: string }) {
  const name = params.name?.trim();
  if (name) return name;
  const email = params.email?.trim();
  if (email) return email;
  const snapshotName = params.snapshotName?.trim();
  if (snapshotName) return snapshotName;
  return "Unknown";
}

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

function LinkPicker({
  projectId,
  linkedTaskId,
  linkedModuleId,
  onLink,
  onUnlink,
}: {
  projectId: string;
  linkedTaskId?: string;
  linkedModuleId?: string;
  onLink: (type: "task" | "module", id: string) => void;
  onUnlink: () => void;
}) {
  const { data: tasks = [] } = useAllTasks({ projectId });
  const { data: modules = [] } = useModules(projectId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const linkedTask = linkedTaskId
    ? tasks.find((t) => t.id === linkedTaskId)
    : undefined;
  const linkedModule = linkedModuleId
    ? modules.find((m) => m.id === linkedModuleId)
    : undefined;

  const filteredTasks = useMemo(
    () =>
      search
        ? tasks.filter((t) =>
            t.title.toLowerCase().includes(search.toLowerCase()),
          )
        : tasks,
    [tasks, search],
  );

  const filteredModules = useMemo(
    () =>
      search
        ? modules.filter((m) =>
            m.name.toLowerCase().includes(search.toLowerCase()),
          )
        : modules,
    [modules, search],
  );

  const handleSelect = (type: "task" | "module", id: string) => {
    onLink(type, id);
    setOpen(false);
    setSearch("");
  };

  if (linkedTask || linkedModule) {
    return (
      <div className={styles.linkRow}>
        <Link2 className={styles.linkIcon} />
        <span className={styles.linkChip}>
          {linkedTask ? (
            <>
              <CheckSquare className={styles.linkChipIcon} />
              {linkedTask.title}
            </>
          ) : (
            <>
              <Layers className={styles.linkChipIcon} />
              {linkedModule?.name}
            </>
          )}
        </span>
        <button className={styles.unlinkButton} onClick={onUnlink}>
          <X className={styles.unlinkIcon} />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.linkRow}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={styles.addLinkButton}>
            <Link2 className={styles.linkIcon} />
            Link to task or module
          </button>
        </PopoverTrigger>
        <PopoverContent className={styles.linkPopover} align="start">
          <div className={styles.linkSearchWrapper}>
            <Search className={styles.linkSearchIcon} />
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.linkSearchInput}
            />
          </div>
          <Tabs defaultValue="task">
            <TabsList className={styles.linkTabs}>
              <TabsTrigger value="task" className={styles.linkTab}>Tasks</TabsTrigger>
              <TabsTrigger value="module" className={styles.linkTab}>Modules</TabsTrigger>
            </TabsList>
            <TabsContent value="task">
              <div className={styles.linkList}>
                {filteredTasks.length === 0 && (
                  <p className={styles.linkEmpty}>No tasks found</p>
                )}
                {filteredTasks.map((t) => (
                  <button
                    key={t.id}
                    className={styles.linkOption}
                    onClick={() => handleSelect("task", t.id)}
                  >
                    <CheckSquare className={styles.linkOptionIcon} />
                    <span className={styles.linkOptionText}>{t.title}</span>
                  </button>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="module">
              <div className={styles.linkList}>
                {filteredModules.length === 0 && (
                  <p className={styles.linkEmpty}>No modules found</p>
                )}
                {filteredModules.map((m) => (
                  <button
                    key={m.id}
                    className={styles.linkOption}
                    onClick={() => handleSelect("module", m.id)}
                  >
                    <Layers className={styles.linkOptionIcon} />
                    <span className={styles.linkOptionText}>{m.name}</span>
                  </button>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function Component() {
  const { projectId, pageId } = useParams();
  const navigate = useNavigate();
  const { data: page, isLoading } = usePage(pageId!);
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
        id: pageId!,
        projectId: projectId!,
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
      { id: pageId!, projectId: projectId! },
      {
        onSuccess: () => {
          navigate(`/projects/${projectId}/pages`);
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
      <div className={styles.skeletonPage}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className={styles.notFound}>
        Page not found
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" className={styles.backBtn} asChild>
          <Link to={`/projects/${projectId}/pages`}>
            <ArrowLeft className={styles.backIcon} />
            Back to Pages
          </Link>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={styles.deleteBtn}
            >
              <Trash2 className={styles.deleteBtnIcon} />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete page?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{title || "Untitled"}&quot;.
                This action cannot be undone.
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
      <div className={styles.titleRow}>
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button className={styles.iconButton}>
              {icon || <FileText className={styles.iconPlaceholder} />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className={styles.emojiGrid}>
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleIconSelect(emoji)}
                  className={styles.emojiButton}
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
          className={styles.titleInput}
        />
      </div>

      {/* Link picker */}
      <LinkPicker
        projectId={projectId!}
        linkedTaskId={page.pageInfo.linkedTaskId}
        linkedModuleId={page.pageInfo.linkedModuleId}
        onLink={(type, id) => {
          updatePage.mutate({
            id: pageId!,
            projectId: projectId!,
            ...(type === "task"
              ? { linkedTaskId: id, linkedModuleId: "" }
              : { linkedModuleId: id, linkedTaskId: "" }),
          });
        }}
        onUnlink={() => {
          updatePage.mutate({
            id: pageId!,
            projectId: projectId!,
            linkedTaskId: "",
            linkedModuleId: "",
          });
        }}
      />

      {/* Editor */}
      {initialized && (
        <RichTextEditor
          content={page.pageInfo.content}
          onChange={handleContentChange}
          placeholder="Start writing..."
        />
      )}

      {/* Footer */}
      <p className={styles.footer}>
        Last edited by{" "}
        {resolveDisplayName({
          name: lastEditor?.name,
          email: lastEditor?.email,
          snapshotName: page.pageInfo.lastEditedByName,
        })},{" "}
        {formatTimeAgo(page.pageInfo.updatedAt)}
      </p>
    </div>
  );
}
