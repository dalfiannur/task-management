import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUIStore } from "@/stores/ui-store";
import { Grid3X3, List } from "lucide-react";
import type { MediaViewMode } from "@/types/media";
import styles from "./media-header.module.css";

export function MediaHeader() {
  const { mediaViewMode, setMediaViewMode } = useUIStore();

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <div>
          <h1 className={styles.title}>Media & Files</h1>
          <p className={styles.subtitle}>
            Manage project files and attachments
          </p>
        </div>
      </div>
      <div className={styles.right}>
        <Tabs
          value={mediaViewMode}
          onValueChange={(v) => setMediaViewMode(v as MediaViewMode)}
        >
          <TabsList className={styles.tabsList}>
            <TabsTrigger value="grid" className={styles.tabsTrigger}>
              <Grid3X3 className={styles.tabsIcon} />
            </TabsTrigger>
            <TabsTrigger value="table" className={styles.tabsTrigger}>
              <List className={styles.tabsIcon} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
