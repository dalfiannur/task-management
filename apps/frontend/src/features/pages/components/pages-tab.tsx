import { useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePages, useCreatePage } from "../api/hooks";
import { PageEditor } from "./page-editor";

/** Master-detail wiki: page list (left) + editor (right). Member-gated. */
export function PagesTab({ projectId }: { projectId: string }) {
  const { pages, isLoading } = usePages(projectId);
  const create = useCreatePage();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default selection → first page; clear when the selected page disappears.
  useEffect(() => {
    if (pages.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !pages.some((p) => p.id === selectedId)) {
      setSelectedId(pages[0].id);
    }
  }, [pages, selectedId]);

  const selected = pages.find((p) => p.id === selectedId) ?? null;

  function newPage() {
    create.mutate(
      { projectId },
      {
        onSuccess: (page) => setSelectedId(page.id),
        onError: (e) => toast.error(e.message || "Failed to create page"),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] border-t">
      <aside className="flex w-64 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between p-2">
          <span className="px-2 text-sm font-medium text-text-muted">
            Pages
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={newPage}
            disabled={create.isPending}
            aria-label="New page"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto px-1">
          {pages.length === 0 ? (
            <li className="p-3 text-sm text-text-muted">No pages yet.</li>
          ) : (
            pages.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    p.id === selectedId ? "bg-surface-sunken" : "hover:bg-surface-sunken/50",
                  )}
                >
                  <span className="w-5 text-center">
                    {p.icon || <FileText className="h-4 w-4 opacity-60" />}
                  </span>
                  <span className="flex-1 truncate">
                    {p.title || "Untitled"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <div className="flex-1">
        {selected ? (
          <PageEditor
            key={selected.id}
            page={selected}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-text-muted">
            <div>
              <p>No page selected.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={newPage}
                disabled={create.isPending}
              >
                <Plus className="mr-1 h-4 w-4" />
                New page
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
