import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  usePages,
  useCreatePage,
  useReorderPages,
} from "@/hooks/use-pages";
import { useUsers } from "@/hooks/use-users";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  FileText,
  GripVertical,
  ArrowLeft,
  Search,
} from "lucide-react";
import type { Page } from "@/types/page";
import type { User } from "@/types/task";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/pages/",
)({
  component: PagesListPage,
});

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

function SortablePageRow({
  page,
  projectId,
  users,
}: {
  page: Page;
  projectId: string;
  users: User[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
    >
      <button
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Link
        to="/projects/$projectId/pages/$pageId"
        params={{ projectId, pageId: page.id }}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <span className="text-lg shrink-0">
          {page.pageInfo.icon || <FileText className="size-5 text-muted-foreground" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate text-sm">
            {page.pageInfo.title || "Untitled"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            Last edited by {users.find((u) => u.id === page.pageInfo.lastEditedById)?.name || page.pageInfo.lastEditedByName || "Unknown"}{" "}
            {formatTimeAgo(page.pageInfo.updatedAt)}
          </p>
        </div>
      </Link>
    </div>
  );
}

function PagesListPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const { data: pages = [], isLoading } = usePages(projectId);
  const { data: users = [] } = useUsers();
  const createPage = useCreatePage();
  const reorderPages = useReorderPages();
  const [orderedPages, setOrderedPages] = useState<Page[] | null>(null);
  const [search, setSearch] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const allPages = orderedPages ?? pages;
  const displayPages = search
    ? allPages.filter((p) =>
        p.pageInfo.title.toLowerCase().includes(search.toLowerCase()),
      )
    : allPages;

  const handleCreatePage = () => {
    createPage.mutate(
      { projectId, title: "Untitled" },
      {
        onSuccess: (page) => {
          navigate({
            to: "/projects/$projectId/pages/$pageId",
            params: { projectId, pageId: page.id },
          });
        },
      },
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayPages.findIndex((p) => p.id === active.id);
    const newIndex = displayPages.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayPages, oldIndex, newIndex);
    setOrderedPages(reordered);
    reorderPages.mutate(
      { projectId, pageIds: reordered.map((p) => p.id) },
      { onSettled: () => setOrderedPages(null) },
    );
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link to="/projects/$projectId" params={{ projectId }}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold font-display tracking-tight">
              Pages
            </h1>
            <p className="text-sm text-muted-foreground">
              Project documentation and notes
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              placeholder="Search pages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-full bg-muted/50 border-0 pl-9 pr-4 h-8 text-sm w-[200px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30 focus:bg-muted transition-colors"
            />
          </div>
          <Button
            size="sm"
            onClick={handleCreatePage}
            disabled={createPage.isPending}
          >
            <Plus className="size-3.5 mr-1.5" />
            New Page
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : displayPages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <FileText className="size-8 text-muted-foreground/30" />
          <div className="text-center">
            <p className="font-medium">
              {search ? "No pages found" : "No pages yet"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-0.5">
              {search
                ? `No pages matching "${search}".`
                : "Create a page to start writing documentation."}
            </p>
          </div>
          {!search && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={handleCreatePage}
              disabled={createPage.isPending}
            >
              <Plus className="size-3.5 mr-1.5" />
              Create Page
            </Button>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayPages.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {displayPages.map((page) => (
                <SortablePageRow
                  key={page.id}
                  page={page}
                  projectId={projectId}
                  users={users}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
