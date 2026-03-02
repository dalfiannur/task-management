import { Link, useParams, useNavigate } from "react-router";
import { useState, useMemo } from "react";
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
  Search,
  CheckSquare,
  Layers,
} from "lucide-react";
import { useAllTasks } from "@/hooks/use-tasks";
import { useModules } from "@/hooks/use-modules";
import type { Page } from "@/types/page";
import type { User } from "@/types/task";
import styles from "./pages-list.module.css";

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
  taskNameMap,
  moduleNameMap,
}: {
  page: Page;
  projectId: string;
  users: User[];
  taskNameMap: Record<string, string>;
  moduleNameMap: Record<string, string>;
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
      className={styles.pageRow}
    >
      <button
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
      >
        <GripVertical className={styles.dragIcon} />
      </button>
      <Link
        to={`/projects/${projectId}/pages/${page.id}`}
        className={styles.pageLink}
      >
        <span className={styles.pageIcon}>
          {page.pageInfo.icon || (
            <FileText className={styles.pageIconFallback} />
          )}
        </span>
        <div className={styles.pageContent}>
          <div className={styles.pageTitleRow}>
            <p className={styles.pageTitle}>
              {page.pageInfo.title || "Untitled"}
            </p>
            {page.pageInfo.linkedTaskId && taskNameMap[page.pageInfo.linkedTaskId] && (
              <span className={styles.linkBadge}>
                <CheckSquare className={styles.linkBadgeIcon} />
                {taskNameMap[page.pageInfo.linkedTaskId]}
              </span>
            )}
            {page.pageInfo.linkedModuleId && moduleNameMap[page.pageInfo.linkedModuleId] && (
              <span className={styles.linkBadge}>
                <Layers className={styles.linkBadgeIcon} />
                {moduleNameMap[page.pageInfo.linkedModuleId]}
              </span>
            )}
          </div>
          <p className={styles.pageMeta}>
            Last edited by{" "}
            {users.find((u) => u.id === page.pageInfo.lastEditedById)?.name ||
              users.find((u) => u.id === page.pageInfo.lastEditedById)?.email ||
              page.pageInfo.lastEditedByName ||
              "Unknown"}{" "}
            {formatTimeAgo(page.pageInfo.updatedAt)}
          </p>
        </div>
      </Link>
    </div>
  );
}

export function Component() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { data: pages = [], isLoading } = usePages(projectId!);
  const { data: users = [] } = useUsers();
  const { data: tasks = [] } = useAllTasks({ projectId });
  const { data: modules = [] } = useModules(projectId);
  const createPage = useCreatePage();

  const taskNameMap = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, t.title])),
    [tasks],
  );
  const moduleNameMap = useMemo(
    () => Object.fromEntries(modules.map((m) => [m.id, m.name])),
    [modules],
  );
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
      { projectId: projectId!, title: "Untitled" },
      {
        onSuccess: (page) => {
          navigate(`/projects/${projectId}/pages/${page.id}`);
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
      { projectId: projectId!, pageIds: reordered.map((p: Page) => p.id) },
      { onSuccess: () => setOrderedPages(null) },
    );
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div>
            <h1 className={styles.title}>
              Pages
            </h1>
            <p className={styles.subtitle}>
              Project documentation and notes
            </p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.searchWrapper}>
            <Search className={styles.searchIcon} />
            <input
              placeholder="Search pages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
          </div>
          <Button
            size="sm"
            onClick={handleCreatePage}
            disabled={createPage.isLoading}
          >
            <Plus className={styles.newBtnIcon} />
            New Page
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className={styles.skeletonList}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : displayPages.length === 0 ? (
        <div className={styles.emptyState}>
          <FileText className={styles.emptyIcon} />
          <div className={styles.emptyText}>
            <p className={styles.emptyTitle}>
              {search ? "No pages found" : "No pages yet"}
            </p>
            <p className={styles.emptySubtitle}>
              {search
                ? `No pages matching "${search}".`
                : "Create a page to start writing documentation."}
            </p>
          </div>
          {!search && (
            <Button
              size="sm"
              variant="outline"
              className={styles.emptyBtn}
              onClick={handleCreatePage}
              disabled={createPage.isLoading}
            >
              <Plus className={styles.emptyBtnIcon} />
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
            <div className={styles.list}>
              {displayPages.map((page) => (
                <SortablePageRow
                  key={page.id}
                  page={page}
                  projectId={projectId!}
                  users={users}
                  taskNameMap={taskNameMap}
                  moduleNameMap={moduleNameMap}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
