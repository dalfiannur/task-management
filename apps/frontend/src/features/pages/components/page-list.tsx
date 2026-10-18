import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, GripVertical, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button, Input } from "sedjiwa-ui";
import { cn } from "@/lib/utils";
import { useReorderPages } from "../api/hooks";
import { editedAgo } from "../format";
import type { Page } from "../types";

/** Sidebar of the Pages tab: search, the ordered page list (drag to
 *  reorder, saved through ReorderPages) and New page. */
export function PageList({
  projectId,
  pages,
  selectedId,
  onSelect,
  onCreate,
  creating,
}: {
  projectId: string;
  pages: Page[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const reorder = useReorderPages();
  const [q, setQ] = useState("");
  // Optimistic order while the reorder request is in flight, so the row
  // doesn't snap back for a beat before the refetch lands.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);

  const ordered = useMemo(() => {
    if (!pendingOrder) return pages;
    const byId = new Map(pages.map((p) => [p.id, p]));
    const out = pendingOrder.flatMap((id) => byId.get(id) ?? []);
    // A page created meanwhile isn't in the pending order; keep it at the end.
    return out.length === pages.length
      ? out
      : [...out, ...pages.filter((p) => !pendingOrder.includes(p.id))];
  }, [pages, pendingOrder]);

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? ordered.filter((p) => (p.title || "Untitled").toLowerCase().includes(needle))
    : ordered;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = ordered.map((p) => p.id);
    const next = arrayMove(
      ids,
      ids.indexOf(String(active.id)),
      ids.indexOf(String(over.id)),
    );
    setPendingOrder(next);
    reorder.mutate(
      { projectId, pageIds: next },
      {
        onError: (e) => toast.error(e.message || "Failed to reorder pages"),
        onSettled: () => setPendingOrder(null),
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="text-label">
          Pages <span className="text-num">({pages.length})</span>
        </h2>
        <Button size="sm" variant="outline" onClick={onCreate} disabled={creating}>
          <Plus className="mr-1 h-4 w-4" />
          {creating ? "Creating…" : "New page"}
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Input.Root appearance="search">
          <Input.LeadingIcon>
            <Search />
          </Input.LeadingIcon>
          <Input.Field
            type="search"
            placeholder="Search pages…"
            aria-label="Search pages"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Input.Root>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No pages match “{q.trim()}”.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={visible.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
              {visible.map((p) => (
                <PageListItem
                  key={p.id}
                  page={p}
                  active={p.id === selectedId}
                  // Reordering a filtered subset would be ambiguous.
                  dragDisabled={!!needle || reorder.isPending}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function PageListItem({
  page,
  active,
  dragDisabled,
  onSelect,
}: {
  page: Page;
  active: boolean;
  dragDisabled: boolean;
  onSelect: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id, disabled: dragDisabled });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative flex items-center rounded-lg",
        "transition-colors [transition-duration:var(--duration-fast)]",
        active ? "bg-muted" : "hover:bg-accent",
        isDragging && "z-10 bg-card shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(page.id)}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-start gap-2 py-1.5 pl-2 pr-6 text-left"
      >
        <span className="mt-px w-5 shrink-0 text-center leading-5">
          {page.icon || (
            <FileText className="mx-auto h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm leading-5",
              active ? "font-medium text-foreground" : "text-foreground",
              !page.title && "text-muted-foreground",
            )}
          >
            {page.title || "Untitled"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            Edited {editedAgo(page.updatedAt)}
          </span>
        </span>
      </button>
      {!dragDisabled && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${page.title || "Untitled"}`}
          className="absolute right-1 top-1/2 -translate-y-1/2 cursor-grab rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
