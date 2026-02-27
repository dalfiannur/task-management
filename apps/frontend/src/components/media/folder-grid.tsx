import { Skeleton } from "@/components/ui/skeleton";
import { Folder } from "lucide-react";
import { FolderCard } from "./folder-card";
import styles from "./folder-grid.module.css";

interface FolderItem {
  id: string;
  name: string;
  subtitle?: string;
}

interface FolderGridProps {
  items: FolderItem[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  emptyMessage?: string;
}

export function FolderGrid({
  items,
  isLoading,
  onOpen,
  emptyMessage = "No items",
}: FolderGridProps) {
  if (isLoading) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className={styles.skeleton} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Folder className={styles.emptyIcon} />
        <p className={styles.emptyText}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <FolderCard
          key={item.id}
          name={item.name}
          subtitle={item.subtitle}
          onDoubleClick={() => onOpen(item.id)}
        />
      ))}
    </div>
  );
}
