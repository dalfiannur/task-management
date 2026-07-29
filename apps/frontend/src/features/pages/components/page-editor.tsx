import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import type { Page } from "../types";
import { useUpdatePage, useDeletePage } from "../api/hooks";

/** Editor pane for one wiki page (markdown content). Explicit save. */
export function PageEditor({
  page,
  onDeleted,
}: {
  page: Page;
  onDeleted: () => void;
}) {
  const update = useUpdatePage();
  const del = useDeletePage();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [content, setContent] = useState(page.content);

  // Re-sync when switching pages.
  useEffect(() => {
    setTitle(page.title);
    setIcon(page.icon);
    setContent(page.content);
  }, [page.id, page.title, page.icon, page.content]);

  const dirty =
    title !== page.title || icon !== page.icon || content !== page.content;

  function save() {
    update.mutate(
      { id: page.id, title, icon, content },
      {
        onSuccess: () => toast.success("Saved."),
        onError: (e) => toast.error(e.message || "Save failed"),
      },
    );
  }

  function remove() {
    del.mutate(
      { id: page.id },
      {
        onSuccess: () => {
          toast.success("Page deleted.");
          onDeleted();
        },
        onError: (e) => toast.error(e.message || "Delete failed"),
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <Input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="📄"
          className="w-14 text-center"
          maxLength={2}
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="flex-1 border-0 text-lg font-medium shadow-none focus-visible:ring-0"
        />
        <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Delete page">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{page.title}”?</AlertDialogTitle>
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
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write in markdown…"
        className="min-h-[24rem] flex-1 resize-none rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
