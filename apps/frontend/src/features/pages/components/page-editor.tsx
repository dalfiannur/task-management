import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
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

/** Editor pane for one wiki page (rich-text HTML content). Explicit save. */
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
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        {/* Lebar ditentukan PEMBUNGKUS, bukan utility di Input-nya.
            `Input` mengambil lebarnya dari CSS Module (`.input { width: 100% }`),
            dan utility Tailwind seperti `w-14` TIDAK bisa mengalahkannya:
            keduanya kelas tunggal berspesifisitas sama (0,1,0), jadi pemenangnya
            ditentukan urutan sumber CSS — dan urutan itu milik Tailwind, bukan
            kita. Pola yang sama sudah menggigit sekali di `project-tab-nav.tsx`.

            Terukur sebelum diperbaiki: field ikon 1174px (bukan 56px) dan field
            judul tergencet jadi 22px. `flex-1` di field judul tidak ikut gagal
            karena ia bukan properti `width`.

            Membungkus bekerja SAMA dengan kontrak modul itu alih-alih melawannya:
            modul menjanjikan "selebar induk", jadi induknya yang diberi ukuran.
            shrink-0 supaya flex tidak menggencetnya balik. */}
        <span className="w-14 shrink-0">
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="📄"
            className="text-center"
            maxLength={2}
            aria-label="Page icon"
          />
        </span>
        {/* min-w-0: tanpa ini basis flex sebuah input tidak boleh menciut di
            bawah lebar intrinsiknya, dan judul panjang mendorong baris melebar
            alih-alih ter-truncate. */}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          aria-label="Page title"
          className="min-w-0 flex-1 border-0 text-lg font-medium shadow-none focus-visible:ring-0"
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
      <div className="flex-1 overflow-auto p-3">
        <RichTextEditor
          value={content}
          onChange={setContent}
          placeholder="Write the page…"
        />
      </div>
    </div>
  );
}
