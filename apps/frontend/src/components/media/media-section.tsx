import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, Upload } from "lucide-react";
import { useMediaFiles } from "@/hooks/use-media";
import { useUIStore } from "@/stores/ui-store";
import { MediaGrid } from "./media-grid";
import { MediaTable } from "./media-table";
import styles from "./media-section.module.css";

interface MediaSectionProps {
  projectId: string;
  mediaProjectId?: string;
  projectName: string;
  defaultOpen?: boolean;
  readOnly?: boolean;
  taskId?: string;
  mimeType?: string;
  onUploadClick?: () => void;
}

export function MediaSection({
  projectId,
  mediaProjectId,
  projectName,
  defaultOpen,
  readOnly,
  taskId,
  mimeType,
  onUploadClick,
}: MediaSectionProps) {
  const { mediaViewMode } = useUIStore();
  const { data: files = [], isLoading } = useMediaFiles({
    projectId,
    mediaProjectId,
    taskId,
    mimeType,
  });

  const fileCount = files.length;

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div className={styles.container}>
        <div className={styles.headerBar}>
          <CollapsibleTrigger className={styles.trigger}>
            <ChevronRight className={styles.chevron} />
            <span className={styles.sectionName}>{projectName}</span>
            <Badge variant="secondary" className={styles.countBadge}>
              {isLoading ? "..." : fileCount}
            </Badge>
            {readOnly && (
              <Badge variant="outline" className={styles.viewOnlyBadge}>
                View Only
              </Badge>
            )}
          </CollapsibleTrigger>
          {!readOnly && onUploadClick && (
            <Button
              size="sm"
              variant="outline"
              className={styles.uploadBtn}
              onClick={onUploadClick}
            >
              <Upload className={styles.uploadIcon} />
              Upload
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className={styles.content}>
            {mediaViewMode === "grid" ? (
              <MediaGrid
                files={files}
                isLoading={isLoading}
                readOnly={readOnly}
              />
            ) : (
              <MediaTable
                files={files}
                isLoading={isLoading}
                readOnly={readOnly}
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
