import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./folder-card.module.css";

interface FolderCardProps {
  name: string;
  subtitle?: string;
  onDoubleClick: () => void;
}

export function FolderCard({ name, subtitle, onDoubleClick }: FolderCardProps) {
  return (
    <Button
      variant="ghost"
      type="button"
      className={styles.card}
      onDoubleClick={onDoubleClick}
    >
      <div className={styles.iconWrapper}>
        <Folder className={styles.icon} />
      </div>
      <div className={styles.info}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
    </Button>
  );
}
