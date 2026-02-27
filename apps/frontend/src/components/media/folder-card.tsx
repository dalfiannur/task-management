import { Folder } from "lucide-react";
import styles from "./folder-card.module.css";

interface FolderCardProps {
  name: string;
  subtitle?: string;
  onDoubleClick: () => void;
}

export function FolderCard({ name, subtitle, onDoubleClick }: FolderCardProps) {
  return (
    <button
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
    </button>
  );
}
